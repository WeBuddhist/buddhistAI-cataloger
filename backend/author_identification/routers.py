"""HTTP routes for Author Identification, mounted at ``/author-identification``.

Access and users; batches and editions read from BDRC's editions API (``client``; the
BDRC password never reaches the browser); answers saved here first and sent to BDRC in the
background (``sync_worker``), with time spent. Plain ``def`` routes: the DB and BDRC calls
are synchronous.
"""
from __future__ import annotations

import logging
from typing import Any, Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from author_identification import client, service, work
from author_identification import repository as repo
from author_identification.client import EditionsApiError
from author_identification.models import AuthorAnswer
from author_identification.deps import (
    author_identification_role,
    has_author_identification_access,
    is_author_identification_admin,
    require_author_identification_access,
    require_author_identification_admin,
    require_logged_in,
)
from author_identification.schemas import (
    ActiveTimeIn,
    AnswerIn,
    AnswerOut,
    ClaimOut,
    MemberOut,
    MemberPageOut,
    MemberUpdateIn,
    MeOut,
    MyTextOut,
    SyncHealthOut,
)
from core.database import get_db
from user.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

# BDRC ids as they appear in paths; anything else never reaches BDRC.
_ID = r"^[A-Za-z0-9._-]{1,80}$"


def _bdrc_failed(exc: EditionsApiError) -> NoReturn:
    """BDRC's own answer when it is about the request (unknown id, changed since loaded,
    text replaced by a newer one (410, with ``superseded_by``), invalid answer); 502 when
    BDRC cannot be reached or refuses our server's login."""
    if exc.status_code in (404, 409, 410, 422):
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    logger.warning("Author Identification: %s", exc)
    if exc.status_code in (401, 403):
        raise HTTPException(status_code=502, detail="BDRC refused our server's login. Tell an admin.")
    raise HTTPException(status_code=502, detail="BDRC could not be reached. Try again in a moment.")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(require_logged_in)):
    """My Author Identification access and role, for the nav and the admin pages."""
    return MeOut(access=has_author_identification_access(user), role=author_identification_role(user))


@router.get(
    "/admin/users",
    response_model=MemberPageOut,
    dependencies=[Depends(require_author_identification_admin)],
)
def list_members(
    q: str | None = None,
    role: str | None = Query(None, pattern="^(admin|reviewer|annotator|none)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Every Cataloger account with its access and role here, for the Users page."""
    return service.list_members(db, q, role, page, page_size)


@router.patch("/admin/users/{user_id}", response_model=MemberOut)
def update_member(
    user_id: str,
    body: MemberUpdateIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_author_identification_admin),
):
    """Give or take access, or change the role here. Nothing else about the account
    changes."""
    return service.update_member(db, user_id, body, admin)


@router.get("/my-texts", response_model=list[MyTextOut])
def my_texts(db: Session = Depends(get_db), user: User = Depends(require_author_identification_access)):
    """My texts (handed to me by "Assign work"), each with BDRC's item."""
    try:
        return work.my_texts(db, user)
    except EditionsApiError as exc:
        _bdrc_failed(exc)


@router.post("/claim", response_model=ClaimOut)
def claim(
    size: int = Query(work.CLAIM_SIZE, ge=1, le=work.MAX_CLAIM_SIZE),
    db: Session = Depends(get_db),
    user: User = Depends(require_author_identification_access),
):
    """Give me my next texts (5 by default). None while I still have texts to finish."""
    try:
        return ClaimOut(claimed=work.claim(db, user, size))
    except EditionsApiError as exc:
        db.rollback()
        _bdrc_failed(exc)


@router.get("/batches/{batch_id}", dependencies=[Depends(require_author_identification_access)])
def get_batch(batch_id: str = Path(pattern=_ID)) -> Any:
    """The batch with its counts per status (open / annotated / reviewed)."""
    try:
        return client.get_batch(batch_id)
    except EditionsApiError as exc:
        _bdrc_failed(exc)


@router.get("/batches/{batch_id}/items", dependencies=[Depends(require_author_identification_access)])
def list_items(
    batch_id: str = Path(pattern=_ID),
    status: Literal["open", "annotated", "reviewed"] | None = None,
    text_rejected: bool | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=client.MAX_PAGE),
) -> Any:
    """One page of the batch's texts, each with the names found and its current answer."""
    try:
        return client.list_items(batch_id, status=status, text_rejected=text_rejected,
                                 offset=offset, limit=limit)
    except EditionsApiError as exc:
        _bdrc_failed(exc)


@router.get("/batches/{batch_id}/items/{item_id}",
            dependencies=[Depends(require_author_identification_access)])
def get_item(batch_id: str = Path(pattern=_ID), item_id: int = Path(ge=1)) -> Any:
    try:
        return client.get_item(batch_id, item_id)
    except EditionsApiError as exc:
        _bdrc_failed(exc)


@router.get("/editions/{edition_id}", dependencies=[Depends(require_author_identification_access)])
def get_edition(edition_id: str = Path(pattern=_ID)) -> Any:
    """The text with its versions and the names found in them."""
    try:
        return client.get_edition(edition_id)
    except EditionsApiError as exc:
        _bdrc_failed(exc)


def _answer_columns(body: AnswerIn) -> dict:
    """The answer as saved: its persons, with the first one repeated in the single-person
    columns (as BDRC's item does), so lists and old readers still see who was answered."""
    persons = [p.model_dump(exclude_none=True) for p in body.persons]
    first = persons[0] if persons else {}
    columns = body.model_dump(exclude={"persons"})
    columns.update(
        persons=persons,
        person_answer=first.get("person_answer", body.person_answer),
        p_id=first.get("p_id"),
        name_bo=first.get("name_bo"),
        confidence=body.confidence if body.confidence is not None else first.get("confidence"),
    )
    return columns


@router.put("/batches/{batch_id}/items/{item_id}", response_model=AnswerOut)
def answer_item(
    body: AnswerIn,
    batch_id: str = Path(pattern=_ID),
    item_id: int = Path(ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_author_identification_access),
):
    """Save the logged-in user's answer here; it is then sent to BDRC in the background
    (``sync_worker``). Saving again adds a new answer, which replaces the old one at BDRC.
    Only the person the text was handed to answers it (or an admin)."""
    assignment = repo.get_assignment(db, batch_id, item_id)
    holder = assignment is not None and assignment.user_id == user.id
    if not holder and not is_author_identification_admin(user):
        raise HTTPException(status_code=403, detail="This text is not one of yours.")
    answer = repo.add_answer(db, AuthorAnswer(batch_id=batch_id, item_id=item_id, user_id=user.id, **_answer_columns(body)))
    if holder:
        repo.complete_assignment(db, batch_id, item_id)
    db.commit()
    db.refresh(answer)
    return answer


@router.get("/batches/{batch_id}/items/{item_id}/answer", response_model=AnswerOut | None,
            dependencies=[Depends(require_author_identification_access)])
def current_answer(batch_id: str = Path(pattern=_ID), item_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """The text's current answer saved here (also before BDRC has it), or null."""
    return repo.latest_answer(db, batch_id, item_id)


@router.post("/batches/{batch_id}/items/{item_id}/active-time", status_code=204)
def add_active_time(
    body: ActiveTimeIn,
    batch_id: str = Path(pattern=_ID),
    item_id: int = Path(ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_author_identification_access),
):
    """Add one visit's active time (seconds on screen and in use) to my time on this text."""
    repo.add_active_time(db, batch_id, item_id, user.id, body.seconds)
    db.commit()


@router.get("/admin/sync", response_model=SyncHealthOut,
            dependencies=[Depends(require_author_identification_admin)])
def sync_health(db: Session = Depends(get_db)):
    """Answers per sending state, and the latest ones BDRC refused."""
    return repo.sync_health(db)
