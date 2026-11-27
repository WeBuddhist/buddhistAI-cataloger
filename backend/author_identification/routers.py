"""HTTP routes for Author Identification, mounted at ``/author-identification``.

Access and users; batches and editions read from BDRC's editions API (``client``; the
BDRC password never reaches the browser); answers saved here first and sent to BDRC in the
background (``sync_worker``), with time spent. Plain ``def`` routes: the DB and BDRC calls
are synchronous.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal, NoReturn, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from author_identification import client, overview, service, work
from author_identification import repository as repo
from author_identification.client import EditionsApiError
from author_identification.models import AuthorAnswer, AuthorDuplicateReport
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
    DecisionIn,
    DuplicateIn,
    DuplicateOut,
    MemberOut,
    MemberPageOut,
    MemberUpdateIn,
    MeOut,
    MyTextOut,
    OverviewOut,
    PersonProgressOut,
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


@router.get("/admin/overview", response_model=OverviewOut,
            dependencies=[Depends(require_author_identification_admin)])
def admin_overview(db: Session = Depends(get_db)):
    """How far the batch being handed out is (BDRC's counts and ours), and each person's
    work: texts given, answered, skipped, still open, time spent, last activity."""
    return overview.overview(db)


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    """An instant from the browser as naive UTC, as times are stored."""
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


@router.get("/admin/annotators", response_model=list[PersonProgressOut],
            dependencies=[Depends(require_author_identification_admin)])
def admin_annotators(
    since: Optional[datetime] = Query(None, description="From this instant (ISO 8601)"),
    until: Optional[datetime] = Query(None, description="Up to this instant, excluded"),
    db: Session = Depends(get_db),
):
    """Each person's work, the busiest first; with a period, only the work done in it."""
    return overview.people(db, _utc(since), _utc(until))


@router.get("/admin/sync", response_model=SyncHealthOut,
            dependencies=[Depends(require_author_identification_admin)])
def sync_health(db: Session = Depends(get_db)):
    """Answers per sending state, and the latest ones BDRC refused."""
    return repo.sync_health(db)


# --- Duplicate reports ---------------------------------------------------------------------


def _names(db: Session, user_ids: set[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    rows = db.query(User.id, User.name, User.email).filter(User.id.in_(user_ids)).all()
    return {uid: name or email for uid, name, email in rows}


def _report_out(report: AuthorDuplicateReport, names: dict[str, str], me: str) -> DuplicateOut:
    out = DuplicateOut.model_validate(report)
    out.mine = report.user_id == me
    out.reporter_name = names.get(report.user_id)
    out.decided_by_name = names.get(report.decided_by) if report.decided_by else None
    return out


@router.get("/duplicates", response_model=list[DuplicateOut])
def list_duplicates(db: Session = Depends(get_db), user: User = Depends(require_author_identification_access)):
    """Every duplicate report, newest first: the cards show who was reported with whom."""
    reports = repo.list_duplicates(db)
    names = _names(db, {r.user_id for r in reports} | {r.decided_by for r in reports if r.decided_by})
    return [_report_out(r, names, user.id) for r in reports]


@router.post("/duplicates", response_model=DuplicateOut, status_code=201)
def report_duplicate(
    body: DuplicateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_author_identification_access),
):
    """Report two BDRC persons as one. When one of them is in the text's answer already sent,
    the answer is sent again, with the other id in ``data.duplicate_p_ids``."""
    if repo.find_pair(db, body.person.id, body.other.id):
        raise HTTPException(status_code=409, detail="These two persons are already reported.")
    current = repo.latest_answer(db, body.batch_id, body.item_id)
    before = repo.duplicate_ids(db, current) if current is not None else []
    report = AuthorDuplicateReport(
        batch_id=body.batch_id,
        item_id=body.item_id,
        text_title=body.text_title,
        user_id=user.id,
        person_id=body.person.id,
        person_name=body.person.name,
        person_dates=body.person.dates,
        other_id=body.other.id,
        other_name=body.other.name,
        other_dates=body.other.dates,
        reason=body.reason.strip(),
    )
    db.add(report)
    db.flush()
    # Sent again only when the report changes what goes with the answer.
    if current is not None and repo.duplicate_ids(db, current) != before:
        repo.resend_current_answer(db, body.batch_id, body.item_id)
    db.commit()
    db.refresh(report)
    return _report_out(report, _names(db, {user.id}), user.id)


@router.delete("/duplicates/{report_id}", status_code=204)
def remove_duplicate(
    report_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_author_identification_access),
):
    """Take back a report (its reporter, or an admin), while it is not decided. The text's
    answer is sent again without it if it went with it."""
    report = repo.get_duplicate(db, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="No such report.")
    if report.user_id != user.id and not is_author_identification_admin(user):
        raise HTTPException(status_code=403, detail="Only who reported it can take it back.")
    if report.decision is not None:
        raise HTTPException(status_code=409, detail="This report was already decided.")
    current = repo.latest_answer(db, report.batch_id, report.item_id)
    before = repo.duplicate_ids(db, current) if current is not None else []
    db.delete(report)
    db.flush()
    if current is not None and repo.duplicate_ids(db, current) != before:
        repo.resend_current_answer(db, report.batch_id, report.item_id)
    db.commit()


@router.put("/duplicates/{report_id}/decision", response_model=DuplicateOut)
def decide_duplicate(
    report_id: str,
    body: DecisionIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_author_identification_admin),
):
    """An admin's decision: the same person, or two different ones (then the other id no
    longer goes to BDRC with the answer: it is sent again without it). Null opens it again."""
    report = repo.get_duplicate(db, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="No such report.")
    current = repo.latest_answer(db, report.batch_id, report.item_id)
    before = repo.duplicate_ids(db, current) if current is not None else []
    report.decision = body.decision
    report.decision_note = body.note.strip() or None if body.decision else None
    report.decided_by = admin.id if body.decision else None
    report.decided_at = datetime.utcnow() if body.decision else None
    db.flush()
    if current is not None and repo.duplicate_ids(db, current) != before:
        repo.resend_current_answer(db, report.batch_id, report.item_id)
    db.commit()
    db.refresh(report)
    return _report_out(report, _names(db, {report.user_id} | ({admin.id} if report.decided_by else set())), admin.id)
