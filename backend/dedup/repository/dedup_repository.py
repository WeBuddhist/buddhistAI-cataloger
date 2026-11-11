"""Database access for the dedup tables. No HTTP, no BDRC calls."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased

from dedup.models.dedup import (
    MAX_ATTEMPTS,
    MODE_DOUBLE,
    MODE_SINGLE,
    SETTING_REVIEW_MODE,
    ROLE_ADJUDICATOR,
    ROLE_ADMIN_CORRECTION,
    ROLE_ANNOTATOR,
    RETRY_BACKOFF_SECONDS,
    SYNC_FAILED,
    SYNC_PENDING,
    SYNC_RUNNING,
    SYNC_SUCCEEDED,
    SYNC_SUPERSEDED,
    DedupActiveTime,
    DedupAdjudication,
    DedupAssignment,
    DedupDecision,
    DedupItem,
    DedupSetting,
)


def evidence_hash(evidence: dict[str, Any]) -> str:
    canonical = json.dumps(evidence, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# --- items -------------------------------------------------------------------

def upsert_item(db: Session, bdrc_item: dict[str, Any]) -> None:
    """Store a copy of a BDRC review item. An existing copy is kept as it was first seen."""
    evidence = bdrc_item.get("evidence") or {}
    stmt = insert(DedupItem).values(
        item_id=bdrc_item["item_id"],
        batch_id=bdrc_item["batch_id"],
        kind=bdrc_item.get("kind") or "pair",
        subject=bdrc_item.get("subject") or {},
        evidence=evidence,
        evidence_hash=evidence_hash(evidence),
        fetched_at=datetime.utcnow(),
    ).on_conflict_do_nothing(index_elements=["item_id"])
    db.execute(stmt)


def get_item(db: Session, item_id: int, *, lock: bool = False) -> Optional[DedupItem]:
    """``lock`` serializes the two annotators' saves on one pair, so the second answer
    always sees the first."""
    if lock:
        return db.execute(select(DedupItem).where(DedupItem.item_id == item_id).with_for_update()).scalar_one_or_none()
    return db.get(DedupItem, item_id)


def set_mode_if_fresh(db: Session, item_id: int, mode: str) -> None:
    """Give an item nobody has answered the review mode it is being claimed under (an
    item released unanswered is claimed afresh)."""
    db.execute(
        DedupItem.__table__.update()
        .where(DedupItem.item_id == item_id, DedupItem.review_mode != mode)
        .where(~select(DedupDecision.id).where(DedupDecision.item_id == item_id).exists())
        .values(review_mode=mode)
    )


# --- settings --------------------------------------------------------------------

def get_setting(db: Session, key: str) -> Optional[DedupSetting]:
    return db.get(DedupSetting, key)


def review_mode(db: Session) -> str:
    """How pairs handed out now are reviewed; double unless an admin chose single."""
    s = get_setting(db, SETTING_REVIEW_MODE)
    return s.value if s is not None else MODE_DOUBLE


def set_setting(db: Session, key: str, value: str, user_id: str) -> DedupSetting:
    stmt = insert(DedupSetting).values(key=key, value=value, updated_by=user_id, updated_at=datetime.utcnow())
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=["key"],
            set_={"value": stmt.excluded.value, "updated_by": stmt.excluded.updated_by, "updated_at": stmt.excluded.updated_at},
        )
    )
    return db.get(DedupSetting, key, populate_existing=True)


def get_items(db: Session, item_ids: Iterable[int]) -> dict[int, DedupItem]:
    ids = list(item_ids)
    if not ids:
        return {}
    rows = db.execute(select(DedupItem).where(DedupItem.item_id.in_(ids))).scalars().all()
    return {r.item_id: r for r in rows}


# --- assignments ---------------------------------------------------------------

def assigned_item_ids(db: Session, item_ids: Iterable[int]) -> set[int]:
    ids = list(item_ids)
    if not ids:
        return set()
    rows = db.execute(
        select(DedupAssignment.item_id).where(DedupAssignment.item_id.in_(ids))
    ).scalars().all()
    return set(rows)


def try_assign(
    db: Session, *, item_id: int, batch_id: str, user_id: str, assigned_by: str, slot: int = 1
) -> bool:
    """Give the user one slot on an item. Returns False if the slot was taken first or
    the user already holds the item's other slot.

    The unique constraints on (item, slot) and (item, user) make this safe when two
    annotators claim at the same moment: exactly one insert wins.
    """
    stmt = (
        insert(DedupAssignment)
        .values(
            item_id=item_id,
            batch_id=batch_id,
            slot=slot,
            user_id=user_id,
            assigned_by=assigned_by,
            assigned_at=datetime.utcnow(),
        )
        .on_conflict_do_nothing()
        .returning(DedupAssignment.id)
    )
    return db.execute(stmt).first() is not None


def open_second_slots(
    db: Session, user_id: str, batch_id: Optional[str], limit: int
) -> list[tuple[int, str, int]]:
    """Double-review items held by exactly one other annotator, in random order, as
    ``(item_id, batch_id, free_slot)``. Random so the same two people are not always
    paired, which would make their agreement mean little."""
    other = aliased(DedupAssignment)
    q = (
        select(DedupAssignment.item_id, DedupAssignment.batch_id, DedupAssignment.slot)
        .join(DedupItem, DedupItem.item_id == DedupAssignment.item_id)
        .where(
            DedupItem.review_mode == MODE_DOUBLE,
            DedupAssignment.user_id != user_id,
            ~select(other.id).where(other.item_id == DedupAssignment.item_id, other.id != DedupAssignment.id).exists(),
        )
        .order_by(func.random())
        .limit(limit)
    )
    if batch_id is not None:
        q = q.where(DedupAssignment.batch_id == batch_id)
    return [(i, b, 3 - s) for i, b, s in db.execute(q).all()]


def get_assignment(db: Session, item_id: int, user_id: str, *, lock: bool = False) -> Optional[DedupAssignment]:
    q = select(DedupAssignment).where(DedupAssignment.item_id == item_id, DedupAssignment.user_id == user_id)
    if lock:  # serializes a save against an admin moving the same item
        q = q.with_for_update()
    return db.execute(q).scalar_one_or_none()


def assignments_for_items(db: Session, item_ids: Iterable[int]) -> list[DedupAssignment]:
    ids = list(item_ids)
    if not ids:
        return []
    return list(db.execute(select(DedupAssignment).where(DedupAssignment.item_id.in_(ids))).scalars().all())


def item_assignments(db: Session, item_id: int) -> list[DedupAssignment]:
    return list(
        db.execute(select(DedupAssignment).where(DedupAssignment.item_id == item_id).order_by(DedupAssignment.slot))
        .scalars()
        .all()
    )


def user_assignments(
    db: Session, user_id: str, batch_id: Optional[str] = None, *, state: str = "all"
) -> list[DedupAssignment]:
    """``state``: ``open`` (not completed), ``done`` (completed) or ``all``. Oldest first.
    ``batch_id`` None means every batch."""
    q = select(DedupAssignment).where(DedupAssignment.user_id == user_id)
    if batch_id is not None:
        q = q.where(DedupAssignment.batch_id == batch_id)
    if state == "open":
        q = q.where(DedupAssignment.completed_at.is_(None))
    elif state == "done":
        q = q.where(DedupAssignment.completed_at.is_not(None))
    return list(db.execute(q.order_by(DedupAssignment.item_id)).scalars().all())


def user_counts_by_batch(db: Session, user_id: str) -> dict[str, dict[str, int]]:
    """``{batch_id: {"open": n, "done": n}}`` for one user."""
    rows = db.execute(
        select(
            DedupAssignment.batch_id,
            func.count().filter(DedupAssignment.completed_at.is_(None)),
            func.count().filter(DedupAssignment.completed_at.is_not(None)),
        )
        .where(DedupAssignment.user_id == user_id)
        .group_by(DedupAssignment.batch_id)
    ).all()
    return {b: {"open": o, "done": d} for b, o, d in rows}


def add_active_seconds(db: Session, item_id: int, user_id: str, seconds: int) -> bool:
    """Add time to this user's total for the pair, only while the pair is theirs (as an
    annotator, or as the adjudicator who took it). The
    add happens in the database, so visits sent at the same moment are both counted."""
    holds = db.execute(
        select(DedupAssignment.id).where(DedupAssignment.item_id == item_id, DedupAssignment.user_id == user_id)
    ).first() or db.execute(
        select(DedupAdjudication.item_id).where(DedupAdjudication.item_id == item_id, DedupAdjudication.user_id == user_id)
    ).first()
    if holds is None:
        return False
    stmt = insert(DedupActiveTime).values(
        item_id=item_id, user_id=user_id, seconds=seconds, updated_at=datetime.utcnow()
    )
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=["item_id", "user_id"],
            set_={"seconds": DedupActiveTime.seconds + stmt.excluded.seconds, "updated_at": stmt.excluded.updated_at},
        )
    )
    return True


def active_seconds(db: Session, user_id: Optional[str] = None) -> dict[tuple[int, str], int]:
    """``{(item_id, user_id): seconds}``, for one user or everyone."""
    q = select(DedupActiveTime.item_id, DedupActiveTime.user_id, DedupActiveTime.seconds)
    if user_id is not None:
        q = q.where(DedupActiveTime.user_id == user_id)
    return {(i, u): s for i, u, s in db.execute(q).all()}


def all_active_time(db: Session) -> list[DedupActiveTime]:
    return list(db.execute(select(DedupActiveTime)).scalars().all())


def mark_opened(db: Session, assignment: DedupAssignment) -> None:
    if assignment.first_opened_at is None:
        assignment.first_opened_at = datetime.utcnow()


# --- decisions -----------------------------------------------------------------

_NEWEST_FIRST = (DedupDecision.decided_at.desc(), DedupDecision.created_at.desc())


def latest_decision(db: Session, item_id: int, user_id: str, role: str = ROLE_ANNOTATOR) -> Optional[DedupDecision]:
    """This person's current answer on the item, in the given role."""
    return db.execute(
        select(DedupDecision)
        .where(DedupDecision.item_id == item_id, DedupDecision.user_id == user_id, DedupDecision.role == role)
        .order_by(*_NEWEST_FIRST)
        .limit(1)
    ).scalar_one_or_none()


def latest_decisions(db: Session, item_ids: Iterable[int]) -> dict[tuple[int, str], DedupDecision]:
    """``{(item_id, user_id): decision}``: each annotator's current answer. Kept per
    person so one annotator never sees the other's answer."""
    ids = list(item_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(DedupDecision)
        .where(DedupDecision.item_id.in_(ids), DedupDecision.role == ROLE_ANNOTATOR)
        .order_by(DedupDecision.item_id, *_NEWEST_FIRST)
    ).scalars().all()
    out: dict[tuple[int, str], DedupDecision] = {}
    for d in rows:
        out.setdefault((d.item_id, d.user_id), d)
    return out


def annotator_answers_for(db: Session, item_ids: Iterable[int]) -> dict[int, dict[int, DedupDecision]]:
    """``{item_id: {slot: decision}}``: the current answer in each annotator slot that
    has one. Only unanswered slots can be moved to someone else, so each answer belongs
    to the slot its author holds."""
    ids = list(item_ids)
    slot_of = {(a.item_id, a.user_id): a.slot for a in assignments_for_items(db, ids)}
    out: dict[int, dict[int, DedupDecision]] = {i: {} for i in ids}
    for key, d in latest_decisions(db, ids).items():
        if key in slot_of:
            out[d.item_id][slot_of[key]] = d
    return out


def annotator_answers(db: Session, item_id: int) -> dict[int, DedupDecision]:
    """``{slot: decision}`` for one item."""
    return annotator_answers_for(db, [item_id])[item_id]


def answer_counts_by_user(
    db: Session, since: Optional[datetime] = None, until: Optional[datetime] = None
) -> dict[str, dict[str, int]]:
    """``{user_id: {verdict: n}}``: each annotator's own current answer per pair (a
    changed answer counts once, as its latest verdict; adjudicator answers excluded).
    ``since``/``until`` keep only pairs the person answered in that period."""
    latest = (
        select(
            DedupDecision.item_id,
            DedupDecision.user_id,
            DedupDecision.verdict,
            func.row_number()
            .over(partition_by=(DedupDecision.item_id, DedupDecision.user_id), order_by=_NEWEST_FIRST)
            .label("rn"),
        )
        .where(DedupDecision.role == ROLE_ANNOTATOR)
        .subquery()
    )
    q = (
        select(latest.c.user_id, latest.c.verdict, func.count())
        .where(latest.c.rn == 1, latest.c.verdict.is_not(None))
        .group_by(latest.c.user_id, latest.c.verdict)
    )
    if since is not None or until is not None:
        # Same period test as the "answered" count: when the person's slot was completed.
        q = q.join(
            DedupAssignment,
            (DedupAssignment.item_id == latest.c.item_id) & (DedupAssignment.user_id == latest.c.user_id),
        )
        if since is not None:
            q = q.where(DedupAssignment.completed_at >= since)
        if until is not None:
            q = q.where(DedupAssignment.completed_at < until)
    rows = db.execute(q).all()
    out: dict[str, dict[str, int]] = {}
    for uid, verdict, n in rows:
        out.setdefault(uid, {})[verdict] = n
    return out


def answer_changes(
    db: Session, item_ids: Optional[Iterable[int]] = None
) -> dict[tuple[int, str], list[datetime]]:
    """``{(item_id, user_id): [when, …]}``: each time an annotator changed their own
    answer on a pair, oldest first. A save that keeps the same answer (e.g. only reports
    a problem) is not a change, and neither is the first answer."""
    q = select(
        DedupDecision.item_id,
        DedupDecision.user_id,
        DedupDecision.verdict,
        DedupDecision.abstention_reason,
        DedupDecision.decided_at,
    ).where(DedupDecision.role == ROLE_ANNOTATOR)
    if item_ids is not None:
        ids = list(item_ids)
        if not ids:
            return {}
        q = q.where(DedupDecision.item_id.in_(ids))
    rows = db.execute(
        q.order_by(DedupDecision.item_id, DedupDecision.user_id, DedupDecision.decided_at, DedupDecision.created_at)
    ).all()
    out: dict[tuple[int, str], list[datetime]] = {}
    prev: dict[tuple[int, str], tuple[Optional[str], Optional[str]]] = {}
    for item_id, uid, verdict, reason, when in rows:
        key = (item_id, uid)
        if key in prev and prev[key] != (verdict, reason):
            out.setdefault(key, []).append(when)
        prev[key] = (verdict, reason)
    return out


def answered_pairs(db: Session) -> list[tuple[int, list[str]]]:
    """Double-review pairs both annotators have answered, with who answered."""
    rows = db.execute(
        select(DedupDecision.item_id, DedupDecision.user_id)
        .join(DedupItem, DedupItem.item_id == DedupDecision.item_id)
        .where(DedupItem.review_mode == MODE_DOUBLE, DedupDecision.role == ROLE_ANNOTATOR)
        .distinct()
    ).all()
    by_item: dict[int, list[str]] = {}
    for item_id, uid in rows:
        by_item.setdefault(item_id, []).append(uid)
    return [(i, users) for i, users in by_item.items() if len(users) == 2]


def answered_counts(db: Session, item_ids: Iterable[int]) -> dict[int, int]:
    """How many annotators have answered each item."""
    ids = list(item_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(DedupDecision.item_id, func.count(func.distinct(DedupDecision.user_id)))
        .where(DedupDecision.item_id.in_(ids), DedupDecision.role == ROLE_ANNOTATOR)
        .group_by(DedupDecision.item_id)
    ).all()
    return dict(rows)


def supersede_pending(db: Session, item_id: int) -> None:
    """Retire unsent answers for the item before queuing a newer one.

    BDRC keeps one value per item, so only the newest final answer needs pushing; an
    older one still waiting would otherwise overwrite it if it happened to be sent later.
    """
    db.query(DedupDecision).filter(
        DedupDecision.item_id == item_id,
        DedupDecision.sync_state == SYNC_PENDING,
    ).update({DedupDecision.sync_state: SYNC_SUPERSEDED}, synchronize_session=False)


def add_decision(db: Session, decision: DedupDecision) -> DedupDecision:
    """Append a decision; if it is queued for BDRC, retire older unsent ones."""
    if decision.sync_state == SYNC_PENDING:
        supersede_pending(db, decision.item_id)
    db.add(decision)
    db.flush()
    return decision


# --- sync queue ------------------------------------------------------------------

def claim_next_decision(db: Session) -> Optional[DedupDecision]:
    """Atomically take the oldest due pending decision and mark it running."""
    row = db.execute(
        text(
            """
            SELECT id FROM dedup_decisions
            WHERE sync_state = :pending
              AND (next_attempt_at IS NULL OR next_attempt_at <= :now)
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """
        ),
        {"pending": SYNC_PENDING, "now": datetime.utcnow()},
    ).first()
    if row is None:
        db.commit()
        return None
    decision = db.get(DedupDecision, row[0])
    decision.sync_state = SYNC_RUNNING
    decision.sync_attempts += 1
    db.commit()
    return decision


def mark_synced(db: Session, decision_id: str) -> None:
    d = db.get(DedupDecision, decision_id)
    if d is None:
        return
    d.sync_state = SYNC_SUCCEEDED
    d.synced_at = datetime.utcnow()
    d.last_error = None
    d.next_attempt_at = None
    db.commit()


def mark_sync_failed(db: Session, decision_id: str, error: str, *, retriable: bool = False) -> None:
    """Schedule the next try.

    ``retriable`` (BDRC unreachable or erroring on its side): keep trying, every 6 hours
    once the backoff schedule is used up, until it is delivered. Otherwise (BDRC
    rejected the answer) give up after the schedule: retrying cannot fix it.
    """
    d = db.get(DedupDecision, decision_id)
    if d is None:
        return
    d.last_error = error[:2000]
    if not retriable and d.sync_attempts >= MAX_ATTEMPTS:
        d.sync_state = SYNC_FAILED
        d.next_attempt_at = None
    else:
        delay = RETRY_BACKOFF_SECONDS[min(d.sync_attempts - 1, len(RETRY_BACKOFF_SECONDS) - 1)]
        d.sync_state = SYNC_PENDING
        d.next_attempt_at = datetime.utcnow() + timedelta(seconds=delay)
    db.commit()


def requeue_stale_running(db: Session, older_than_minutes: int = 30) -> int:
    """Return decisions orphaned by a restart mid-push to pending, so they are retried."""
    cutoff = datetime.utcnow() - timedelta(minutes=older_than_minutes)
    stale = (
        db.query(DedupDecision)
        .filter(DedupDecision.sync_state == SYNC_RUNNING, DedupDecision.updated_at < cutoff)
        .all()
    )
    for d in stale:
        d.sync_state = SYNC_PENDING
        d.next_attempt_at = None
        d.last_error = "Requeued: worker stopped mid-push"
    if stale:
        db.commit()
    return len(stale)


def sync_health(db: Session, limit: int = 50) -> dict[str, Any]:
    counts = dict(
        db.execute(
            select(DedupDecision.sync_state, func.count()).group_by(DedupDecision.sync_state)
        ).all()
    )
    failed = db.execute(
        select(DedupDecision)
        .where(DedupDecision.sync_state == SYNC_FAILED)
        .order_by(DedupDecision.updated_at.desc())
        .limit(limit)
    ).scalars().all()
    return {
        "counts": counts,
        "failed": [
            {
                "decision_id": d.id,
                "item_id": d.item_id,
                "user_id": d.user_id,
                "attempts": d.sync_attempts,
                "last_error": d.last_error,
                "updated_at": d.updated_at.isoformat() if d.updated_at else None,
            }
            for d in failed
        ],
    }


# --- admin -----------------------------------------------------------------------

def assignment_counts_by_batch(db: Session) -> dict[str, dict[str, int]]:
    """``{batch_id: {"assigned": n, "done": n, "pairs": n}}`` across all annotators:
    annotator slots handed out and answered, and distinct pairs handed out (a pair has
    two slots in double review)."""
    rows = db.execute(
        select(
            DedupAssignment.batch_id,
            func.count(),
            func.count().filter(DedupAssignment.completed_at.is_not(None)),
            func.count(func.distinct(DedupAssignment.item_id)),
        ).group_by(DedupAssignment.batch_id)
    ).all()
    return {b: {"assigned": n, "done": d, "pairs": p} for b, n, d, p in rows}


def latest_decision_per_item(db: Session) -> list[DedupDecision]:
    """The current final answer of every settled item (older rows ignored)."""
    ranked = (
        select(
            DedupDecision.id,
            func.row_number()
            .over(partition_by=DedupDecision.item_id, order_by=_NEWEST_FIRST)
            .label("rn"),
        )
        .where(DedupDecision.is_final.is_(True))
    ).subquery()
    return list(
        db.execute(
            select(DedupDecision).join(ranked, ranked.c.id == DedupDecision.id).where(ranked.c.rn == 1)
        ).scalars().all()
    )


def final_decision(db: Session, item_id: int) -> Optional[DedupDecision]:
    """The item's current final answer, whoever gave it (annotator, adjudicator or admin)."""
    return db.execute(
        select(DedupDecision)
        .where(DedupDecision.item_id == item_id, DedupDecision.is_final.is_(True))
        .order_by(*_NEWEST_FIRST)
        .limit(1)
    ).scalar_one_or_none()


def decision_history(db: Session, item_id: int) -> list[DedupDecision]:
    """Every answer ever saved on the item, oldest first."""
    return list(
        db.execute(
            select(DedupDecision)
            .where(DedupDecision.item_id == item_id)
            .order_by(DedupDecision.decided_at, DedupDecision.created_at)
        ).scalars().all()
    )


PAIR_SORTS = ("newest", "oldest", "id_desc", "id_asc")


def search_pairs(
    db: Session,
    *,
    batch_id: Optional[str] = None,
    verdict: Optional[str] = None,
    annotator_id: Optional[str] = None,
    adjudicator_id: Optional[str] = None,
    corrected_by: Optional[str] = None,
    corrected: Optional[bool] = None,
    q: Optional[str] = None,
    sort: str = "newest",
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[tuple[DedupItem, Optional[DedupDecision]]], int]:
    """Handed-out pairs with their current final answer (None if unanswered), filtered,
    sorted and paged, plus the total before paging.

    ``verdict`` "none" means no final answer yet; ``annotator_id`` is anyone assigned to
    the pair; ``adjudicator_id`` the person its adjudication is with, settled or not;
    ``corrected_by`` an admin who corrected its answer; ``q`` is a pair number, or part of a batch id, an MW id or a title.
    """
    ranked = (
        select(
            DedupDecision.id.label("id"),
            DedupDecision.item_id.label("item_id"),
            func.row_number().over(partition_by=DedupDecision.item_id, order_by=_NEWEST_FIRST).label("rn"),
        )
        .where(DedupDecision.is_final.is_(True))
        .subquery()
    )
    final = aliased(DedupDecision)
    stmt = (
        select(DedupItem, final)
        .outerjoin(ranked, (ranked.c.item_id == DedupItem.item_id) & (ranked.c.rn == 1))
        .outerjoin(final, final.id == ranked.c.id)
    )
    if batch_id:
        stmt = stmt.where(DedupItem.batch_id == batch_id)
    if verdict == "none":
        stmt = stmt.where(final.id.is_(None))
    elif verdict:
        stmt = stmt.where(final.verdict == verdict)
    if annotator_id:
        stmt = stmt.where(
            select(DedupAssignment.id)
            .where(DedupAssignment.item_id == DedupItem.item_id, DedupAssignment.user_id == annotator_id)
            .exists()
        )
    if adjudicator_id:
        stmt = stmt.where(
            select(DedupAdjudication.item_id)
            .where(DedupAdjudication.item_id == DedupItem.item_id, DedupAdjudication.user_id == adjudicator_id)
            .exists()
        )
    if corrected_by:
        stmt = stmt.where(
            select(DedupDecision.id)
            .where(
                DedupDecision.item_id == DedupItem.item_id,
                DedupDecision.role == ROLE_ADMIN_CORRECTION,
                DedupDecision.user_id == corrected_by,
            )
            .exists()
        )
    if corrected is not None:
        was_corrected = (
            select(DedupDecision.id)
            .where(DedupDecision.item_id == DedupItem.item_id, DedupDecision.role == ROLE_ADMIN_CORRECTION)
            .exists()
        )
        stmt = stmt.where(was_corrected if corrected else ~was_corrected)
    q = (q or "").strip().lstrip("#")
    if q.isdigit():
        stmt = stmt.where(DedupItem.item_id == int(q))
    elif q:
        like = f"%{q}%"
        stmt = stmt.where(
            DedupItem.batch_id.ilike(like)
            | DedupItem.subject["a_mw"].as_string().ilike(like)
            | DedupItem.subject["b_mw"].as_string().ilike(like)
            | DedupItem.evidence[("a", "title_bo")].as_string().ilike(like)
            | DedupItem.evidence[("b", "title_bo")].as_string().ilike(like)
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    order = {
        "newest": (final.decided_at.desc().nulls_last(), DedupItem.item_id.desc()),
        "oldest": (final.decided_at.asc().nulls_last(), DedupItem.item_id.asc()),
        "id_desc": (DedupItem.item_id.desc(),),
        "id_asc": (DedupItem.item_id.asc(),),
    }[sort]
    rows = db.execute(stmt.order_by(*order).offset(offset).limit(limit)).all()
    return [(item, decision) for item, decision in rows], total


def corrected_item_ids(db: Session, item_ids: Iterable[int]) -> set[int]:
    """The items an admin has corrected; nobody else may change their answer after that."""
    ids = list(item_ids)
    if not ids:
        return set()
    return set(
        db.execute(
            select(DedupDecision.item_id)
            .where(DedupDecision.item_id.in_(ids), DedupDecision.role == ROLE_ADMIN_CORRECTION)
            .distinct()
        ).scalars().all()
    )


def last_decision_by_user(db: Session) -> dict[str, datetime]:
    """Each annotator's latest saved answer (changing an answer counts as activity)."""
    rows = db.execute(
        select(DedupDecision.user_id, func.max(DedupDecision.decided_at)).group_by(DedupDecision.user_id)
    ).all()
    return {u: t for u, t in rows}


def all_assignments(db: Session) -> list[DedupAssignment]:
    return list(db.execute(select(DedupAssignment)).scalars().all())


def _slots(db: Session, item_ids: list[int], from_user_id: Optional[str]) -> list[DedupAssignment]:
    q = select(DedupAssignment).where(DedupAssignment.item_id.in_(item_ids))
    if from_user_id is not None:
        q = q.where(DedupAssignment.user_id == from_user_id)
    return list(db.execute(q.with_for_update()).scalars().all())


def reassign(
    db: Session, item_ids: list[int], to_user_id: str, admin_id: str, from_user_id: Optional[str] = None
) -> tuple[list[int], list[int]]:
    """Move unfinished slots to another annotator. Returns (moved, skipped).

    ``from_user_id`` picks whose slot moves; without it every unfinished slot on the
    items does. Finished slots are skipped: their decision belongs to whoever made it.
    So is a pair whose other slot the target already holds: nobody answers a pair
    twice. The opened time is reset so time spent is measured for the new annotator.
    """
    rows = _slots(db, item_ids, from_user_id)
    holders = {(a.item_id, a.user_id) for a in db.execute(
        select(DedupAssignment).where(DedupAssignment.item_id.in_(item_ids))
    ).scalars()}
    now = datetime.utcnow()
    moved, skipped = [], []
    for a in rows:
        if a.completed_at is not None or (a.user_id != to_user_id and (a.item_id, to_user_id) in holders):
            skipped.append(a.item_id)
            continue
        a.user_id = to_user_id
        a.assigned_by = admin_id
        a.assigned_at = now
        a.first_opened_at = None
        moved.append(a.item_id)
    skipped += [i for i in item_ids if i not in {a.item_id for a in rows}]
    return moved, skipped


def release(db: Session, item_ids: list[int], from_user_id: Optional[str] = None) -> tuple[list[int], list[int]]:
    """Return unfinished slots to the pool (anyone's next claim can take them)."""
    rows = _slots(db, item_ids, from_user_id)
    moved, skipped = [], []
    for a in rows:
        if a.completed_at is not None:
            skipped.append(a.item_id)
            continue
        db.delete(a)
        moved.append(a.item_id)
    skipped += [i for i in item_ids if i not in {a.item_id for a in rows}]
    return moved, skipped


# --- adjudication ------------------------------------------------------------------

def open_adjudication(db: Session, item_id: int) -> None:
    """Queue a disagreeing pair for adjudication (once)."""
    db.execute(
        insert(DedupAdjudication)
        .values(item_id=item_id, created_at=datetime.utcnow())
        .on_conflict_do_nothing(index_elements=["item_id"])
    )


def get_adjudication(db: Session, item_id: int, *, lock: bool = False) -> Optional[DedupAdjudication]:
    q = select(DedupAdjudication).where(DedupAdjudication.item_id == item_id)
    if lock:
        q = q.with_for_update()
    return db.execute(q).scalar_one_or_none()


def get_adjudications(db: Session, item_ids: Iterable[int]) -> dict[int, DedupAdjudication]:
    ids = list(item_ids)
    if not ids:
        return {}
    rows = db.execute(select(DedupAdjudication).where(DedupAdjudication.item_id.in_(ids))).scalars().all()
    return {r.item_id: r for r in rows}


def adjudication_queue(db: Session, user_id: str, state: str = "open") -> list[DedupAdjudication]:
    """Pairs this person may settle, oldest first.

    ``open``: not settled, and free or already taken by them. ``done``: settled by them.
    Pairs they annotated never appear.
    """
    q = select(DedupAdjudication).where(
        ~select(DedupAssignment.id)
        .where(DedupAssignment.item_id == DedupAdjudication.item_id, DedupAssignment.user_id == user_id)
        .exists()
    )
    open_q = DedupAdjudication.completed_at.is_(None) & (
        DedupAdjudication.user_id.is_(None) | (DedupAdjudication.user_id == user_id)
    )
    done_q = DedupAdjudication.completed_at.is_not(None) & (DedupAdjudication.user_id == user_id)
    if state == "open":
        q = q.where(open_q)
    elif state == "done":
        q = q.where(done_q)
    else:
        q = q.where(open_q | done_q)
    return list(db.execute(q.order_by(DedupAdjudication.created_at, DedupAdjudication.item_id)).scalars().all())


def all_adjudications(db: Session) -> list[DedupAdjudication]:
    return list(db.execute(select(DedupAdjudication).order_by(DedupAdjudication.created_at)).scalars().all())


def latest_adjudicator_decisions(db: Session, item_ids: Iterable[int]) -> dict[int, DedupDecision]:
    """``{item_id: decision}``: the current adjudicator answer per item."""
    ids = list(item_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(DedupDecision)
        .where(DedupDecision.item_id.in_(ids), DedupDecision.role == ROLE_ADJUDICATOR)
        .order_by(DedupDecision.item_id, *_NEWEST_FIRST)
    ).scalars().all()
    out: dict[int, DedupDecision] = {}
    for d in rows:
        out.setdefault(d.item_id, d)
    return out


def disputed_item_ids(db: Session, item_ids: Optional[Iterable[int]] = None) -> set[int]:
    """Pairs in adjudication because their annotators disagreed, or either could not
    answer. The rest of the queue are final checks of pairs both answered alike, put
    there on purpose: they do not count against the annotators' agreement."""
    ids = [a.item_id for a in all_adjudications(db)] if item_ids is None else list(item_ids)
    answers = annotator_answers_for(db, ids)
    disputed = set()
    for item_id in ids:
        verdicts = [d.verdict for d in answers.get(item_id, {}).values()]
        if len(verdicts) < 2 or len(set(verdicts)) > 1 or "not_sure" in verdicts:
            disputed.add(item_id)
    return disputed


def double_review_counts(db: Session) -> dict[str, int]:
    """Double-review pairs by stage."""
    one_slot = (
        select(DedupAssignment.item_id)
        .join(DedupItem, DedupItem.item_id == DedupAssignment.item_id)
        .where(DedupItem.review_mode == MODE_DOUBLE)
        .group_by(DedupAssignment.item_id)
        .having(func.count() == 1)
    ).subquery()
    answered = (
        select(DedupDecision.item_id)
        .join(DedupItem, DedupItem.item_id == DedupDecision.item_id)
        .where(DedupItem.review_mode == MODE_DOUBLE, DedupDecision.role == ROLE_ANNOTATOR)
        .group_by(DedupDecision.item_id)
        .having(func.count(func.distinct(DedupDecision.user_id)) == 2)
    ).subquery()
    adj = db.execute(
        select(
            func.count().filter(DedupAdjudication.completed_at.is_(None) & DedupAdjudication.user_id.is_(None)),
            func.count().filter(DedupAdjudication.completed_at.is_(None) & DedupAdjudication.user_id.is_not(None)),
            func.count().filter(DedupAdjudication.completed_at.is_not(None)),
            func.count(),
        )
    ).one()
    both = db.execute(select(func.count()).select_from(answered)).scalar_one()
    return {
        "awaiting_second": db.execute(select(func.count()).select_from(one_slot)).scalar_one(),
        "both_answered": both,
        "agreed": both - len(disputed_item_ids(db)),
        "adjudication_waiting": adj[0],
        "adjudication_in_progress": adj[1],
        "adjudicated": adj[2],
    }
