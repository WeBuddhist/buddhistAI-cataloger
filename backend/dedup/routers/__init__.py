"""HTTP routes for the dedup review tool, mounted at ``/dedup``.

Annotator routes require the ``dedup`` permission; ``/adjudication`` routes also need
role reviewer or admin; ``/admin`` routes require role admin. The read-only pair page
(``/pairs``, ``/texts``, ``/diff``) opens for any logged-in account, so a pair can be
shared as a link.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.database import get_db
from dedup import client
from dedup.client import ReviewApiError
from dedup.controller import adjudication as adj_ctrl
from dedup.controller import admin as admin_ctrl
from dedup.controller import dedup as ctrl
from dedup.deps import require_dedup_access, require_dedup_admin, require_logged_in
from dedup.repository import dedup_repository as repo
from dedup.schemas import (
    ActiveTimeIn,
    AdjudicationIn,
    AdjudicationItemOut,
    AdjudicationReassignIn,
    AdminAdjudicationOut,
    AdminOverviewOut,
    AdminPairListOut,
    AdminPairOut,
    AnnotatorOut,
    BatchOut,
    ClaimOut,
    CorrectionIn,
    DecisionIn,
    ItemOut,
    PairOut,
    PairSourcesOut,
    ReassignIn,
    ReassignOut,
    SettingsIn,
    SettingsOut,
    SyncHealthOut,
)
from user.models.user import User

router = APIRouter()
annotator_router = APIRouter(dependencies=[Depends(require_dedup_access)])
# Read-only views of a pair, for links shared outside the tool (e.g. a spreadsheet).
viewer_router = APIRouter(dependencies=[Depends(require_logged_in)])


@annotator_router.get("/batches", response_model=list[BatchOut])
def list_batches(
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Review batches from BDRC, with BDRC's progress and this user's own counts."""
    return ctrl.list_batches(db, user)


@annotator_router.post("/claim", response_model=ClaimOut)
def claim_next(
    size: int = Query(ctrl.CLAIM_SIZE, ge=1, le=ctrl.MAX_CLAIM_SIZE),
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Get my next set of items from the oldest batch with work left. Returns my
    unfinished items instead if I still have any."""
    return ctrl.claim_items(db, user, None, size)


@annotator_router.get("/my-items", response_model=list[ItemOut])
def my_items_all(
    state: Literal["open", "done", "all"] = "all",
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Items assigned to me, across all batches."""
    return ctrl.my_items(db, user, None, state)


@annotator_router.post("/batches/{batch_id}/claim", response_model=ClaimOut)
def claim(
    batch_id: str,
    size: int = Query(ctrl.CLAIM_SIZE, ge=1, le=ctrl.MAX_CLAIM_SIZE),
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Get my next set of items. Returns my unfinished items instead if I still have any."""
    return ctrl.claim_items(db, user, batch_id, size)


@annotator_router.get("/batches/{batch_id}/my-items", response_model=list[ItemOut])
def my_items(
    batch_id: str,
    state: Literal["open", "done", "all"] = "all",
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Items assigned to me in this batch."""
    return ctrl.my_items(db, user, batch_id, state)


@annotator_router.get("/items/{item_id}", response_model=ItemOut)
def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """One item (assignee or admin only). Records when the assignee first opened it."""
    return ctrl.get_item(db, user, item_id)


@annotator_router.post("/items/{item_id}/decision", response_model=ItemOut)
def save_decision(
    item_id: int,
    body: DecisionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Record my decision. Saved here first, then pushed to BDRC in the background."""
    return ctrl.save_decision(db, user, item_id, body)


@annotator_router.post("/items/{item_id}/active-time", status_code=204)
def add_active_time(
    item_id: int,
    body: ActiveTimeIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Add one visit's active time (seconds on screen and in use) to my pair."""
    ctrl.add_active_time(db, user, item_id, body.seconds)


# --- adjudication (reviewer or admin; never on a pair they annotated) ----------------

@annotator_router.get("/adjudication/items", response_model=list[AdjudicationItemOut])
def adjudication_queue(
    state: Literal["open", "done", "all"] = "open",
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Disputed pairs I may settle (free or taken by me), oldest first; ``done``: ones I settled."""
    return adj_ctrl.queue(db, user, state)


@annotator_router.get("/adjudication/items/{item_id}", response_model=AdjudicationItemOut)
def adjudication_item(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """One disputed pair with both annotators' answers. Opening it takes it, if free."""
    return adj_ctrl.get_item(db, user, item_id)


@annotator_router.post("/adjudication/items/{item_id}/decision", response_model=AdjudicationItemOut)
def adjudication_decision(
    item_id: int,
    body: AdjudicationIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_dedup_access),
):
    """Record my final answer for a disputed pair; it is pushed to BDRC in the background."""
    return adj_ctrl.save_decision(db, user, item_id, body)


# --- read-only, any logged-in account ------------------------------------------------

@viewer_router.get("/pairs/{item_id}", response_model=PairOut)
def get_pair(item_id: int, db: Session = Depends(get_db)):
    """One pair's evidence for a shared link: no answers, no assignment."""
    return ctrl.get_pair(db, item_id)


@viewer_router.get("/pairs/{item_id}/sources", response_model=PairSourcesOut)
def get_pair_sources(item_id: int, db: Session = Depends(get_db)):
    """Where the pair's texts sit in their volumes, to open their scans at the right page."""
    return ctrl.get_pair_sources(db, item_id)


@viewer_router.get("/texts/{mw_id}")
def get_text(mw_id: str):
    """Full text of one witness (BDRC ``/review/texts/{mw_id}``)."""
    try:
        return client.get_text(mw_id)
    except ReviewApiError as exc:
        raise ctrl.bdrc_error(exc) from exc


@viewer_router.get("/diff")
def get_diff(
    a: str,
    b: str,
    granularity: Literal["syllable", "char", "line"] = "syllable",
):
    """Aligned diff between two witnesses (BDRC ``/review/diff``)."""
    try:
        return client.get_diff(a, b, granularity)
    except ReviewApiError as exc:
        raise ctrl.bdrc_error(exc) from exc


# --- admin (role admin; the annotator permission is not required) -------------------

admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_dedup_admin)])


@admin_router.get("/overview", response_model=AdminOverviewOut)
def admin_overview(
    since: datetime | None = None,
    until: datetime | None = None,
    db: Session = Depends(get_db),
):
    """Batch progress, answers, abstentions, issues and sync health; ``since``/``until``
    (until excluded) limit the work counts to a period."""
    return admin_ctrl.overview(db, since, until)


@admin_router.get("/annotators", response_model=list[AnnotatorOut])
def admin_annotators(
    since: datetime | None = None,
    until: datetime | None = None,
    db: Session = Depends(get_db),
):
    """Work and time per annotator; ``since``/``until`` (until excluded) limit it to a period."""
    return admin_ctrl.annotators(db, since, until)


@admin_router.get("/annotators/{user_id}/items", response_model=list[ItemOut])
def admin_annotator_items(
    user_id: str,
    state: Literal["open", "done", "all"] = "all",
    since: datetime | None = None,
    until: datetime | None = None,
    db: Session = Depends(get_db),
):
    """One annotator's items; with ``since``/``until``, only those answered in that period."""
    return admin_ctrl.annotator_items(db, user_id, state, since, until)


@admin_router.post("/reassign", response_model=ReassignOut)
def admin_reassign(
    body: ReassignIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_dedup_admin),
):
    """Move unfinished slots to another annotator, or release them (to_user_id null).
    ``from_user_id`` picks whose slot moves, since a pair has two."""
    return admin_ctrl.reassign(db, admin, body)


@admin_router.get("/adjudications", response_model=list[AdminAdjudicationOut])
def admin_adjudications(
    state: Literal["open", "done", "all"] = "all",
    db: Session = Depends(get_db),
):
    """Every disputed pair, with both answers, who gave them, and who is settling it."""
    return admin_ctrl.adjudications(db, state)


@admin_router.post("/adjudications/reassign", response_model=ReassignOut)
def admin_reassign_adjudications(
    body: AdjudicationReassignIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_dedup_admin),
):
    """Hand unsettled disputed pairs to another adjudicator, or back to the queue (to_user_id null)."""
    return admin_ctrl.reassign_adjudications(db, admin, body)


@admin_router.get("/pairs", response_model=AdminPairListOut)
def admin_pairs(
    batch_id: str | None = None,
    verdict: Literal["same", "different", "contains", "part_of", "source_dup", "not_sure", "none"] | None = None,
    annotator_id: str | None = None,
    corrected: bool | None = None,
    q: str | None = Query(None, max_length=200),
    sort: Literal["newest", "oldest", "id_desc", "id_asc"] = "newest",
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Every handed-out pair with its current final answer, filtered and sorted.
    ``verdict=none``: no final answer yet. ``q``: a pair number, or part of a batch id, MW id or title."""
    return admin_ctrl.list_pairs(
        db, batch_id=batch_id, verdict=verdict, annotator_id=annotator_id, corrected=corrected,
        q=q, sort=sort, offset=offset, limit=limit,
    )


@admin_router.get("/pairs/{item_id}", response_model=AdminPairOut)
def admin_pair(item_id: int, db: Session = Depends(get_db)):
    """One pair with its current final answer and every answer saved on it, for the
    admin correction page. The shared ``/pairs/{item_id}`` page stays answer-free."""
    return admin_ctrl.pair(db, item_id)


@admin_router.post("/pairs/{item_id}/correction", response_model=AdminPairOut)
def admin_correct_pair(
    item_id: int,
    body: CorrectionIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_dedup_admin),
):
    """Replace the pair's final answer with the admin's; it is pushed to BDRC in the
    background. Earlier answers stay in the history, and the pair is locked for
    annotators and adjudicators from then on."""
    return admin_ctrl.correct_pair(db, admin, item_id, body)


@admin_router.get("/settings", response_model=SettingsOut)
def admin_settings(db: Session = Depends(get_db)):
    """Deduplicator-wide settings, e.g. whether new pairs get single or double review."""
    return admin_ctrl.settings(db)


@admin_router.put("/settings", response_model=SettingsOut)
def admin_update_settings(
    body: SettingsIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_dedup_admin),
):
    """Change the review mode for pairs handed out from now on."""
    return admin_ctrl.update_settings(db, admin, body)


@admin_router.get("/sync-health", response_model=SyncHealthOut)
def sync_health(db: Session = Depends(get_db)):
    """Decisions by sync state, plus the ones that gave up."""
    return repo.sync_health(db)


router.include_router(annotator_router)
router.include_router(viewer_router)
router.include_router(admin_router)

__all__ = ["router"]
