"""Database access for Author Identification answers, their sending queue and time spent."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from author_identification.models import (
    RETRY_BACKOFF_SECONDS,
    SYNC_FAILED,
    SYNC_PENDING,
    SYNC_RUNNING,
    SYNC_SUCCEEDED,
    SYNC_SUPERSEDED,
    AuthorActiveTime,
    AuthorAnswer,
    AuthorAssignment,
    AuthorDuplicateReport,
)

_NEWEST_FIRST = (AuthorAnswer.decided_at.desc(), AuthorAnswer.created_at.desc())


# --- answers ---------------------------------------------------------------------

def add_answer(db: Session, answer: AuthorAnswer) -> AuthorAnswer:
    """Append an answer; older answers of the same text not sent yet are retired, since
    BDRC keeps one answer per text and only the latest is sent."""
    db.query(AuthorAnswer).filter(
        AuthorAnswer.batch_id == answer.batch_id,
        AuthorAnswer.item_id == answer.item_id,
        AuthorAnswer.sync_state == SYNC_PENDING,
    ).update({AuthorAnswer.sync_state: SYNC_SUPERSEDED}, synchronize_session=False)
    db.add(answer)
    db.flush()
    return answer


def latest_answer(db: Session, batch_id: str, item_id: int) -> Optional[AuthorAnswer]:
    """The text's current answer: the newest saved, by anyone."""
    return db.execute(
        select(AuthorAnswer)
        .where(AuthorAnswer.batch_id == batch_id, AuthorAnswer.item_id == item_id)
        .order_by(*_NEWEST_FIRST)
        .limit(1)
    ).scalar_one_or_none()


def answer_history(db: Session, batch_id: str, item_id: int) -> list[AuthorAnswer]:
    return list(db.execute(
        select(AuthorAnswer)
        .where(AuthorAnswer.batch_id == batch_id, AuthorAnswer.item_id == item_id)
        .order_by(*_NEWEST_FIRST)
    ).scalars().all())


# --- assignments ("Assign work") ---------------------------------------------------

def user_assignments(db: Session, user_id: str, *, open_only: bool = False) -> list[AuthorAssignment]:
    """My texts, in the order they were handed out (then batch order)."""
    q = select(AuthorAssignment).where(AuthorAssignment.user_id == user_id)
    if open_only:
        q = q.where(AuthorAssignment.completed_at.is_(None))
    return list(db.execute(
        q.order_by(AuthorAssignment.assigned_at, AuthorAssignment.batch_id, AuthorAssignment.item_id)
    ).scalars().all())


def get_assignment(db: Session, batch_id: str, item_id: int) -> Optional[AuthorAssignment]:
    return db.get(AuthorAssignment, (batch_id, item_id))


def assigned_item_ids(db: Session, batch_id: str, item_ids: list[int]) -> set[int]:
    """Those of ``item_ids`` someone already holds."""
    if not item_ids:
        return set()
    return set(db.execute(
        select(AuthorAssignment.item_id).where(
            AuthorAssignment.batch_id == batch_id, AuthorAssignment.item_id.in_(item_ids)
        )
    ).scalars().all())


def try_assign(db: Session, *, batch_id: str, item_id: int, user_id: str, edition_id: Optional[str]) -> bool:
    """Give the text to this person unless someone holds it (also when two people ask at
    the same moment). Not committed."""
    stmt = insert(AuthorAssignment).values(
        batch_id=batch_id, item_id=item_id, user_id=user_id, edition_id=edition_id, assigned_at=datetime.utcnow()
    ).on_conflict_do_nothing(index_elements=[AuthorAssignment.batch_id, AuthorAssignment.item_id])
    return db.execute(stmt.returning(AuthorAssignment.item_id)).first() is not None


def complete_assignment(db: Session, batch_id: str, item_id: int) -> None:
    """The text has an answer: its holder is done with it. Not committed."""
    a = db.get(AuthorAssignment, (batch_id, item_id))
    if a is not None and a.completed_at is None:
        a.completed_at = datetime.utcnow()


# --- time spent ------------------------------------------------------------------

def add_active_time(db: Session, batch_id: str, item_id: int, user_id: str, seconds: int) -> None:
    stmt = insert(AuthorActiveTime).values(
        batch_id=batch_id, item_id=item_id, user_id=user_id, seconds=seconds, updated_at=datetime.utcnow()
    )
    db.execute(stmt.on_conflict_do_update(
        index_elements=[AuthorActiveTime.batch_id, AuthorActiveTime.item_id, AuthorActiveTime.user_id],
        set_={"seconds": AuthorActiveTime.seconds + stmt.excluded.seconds, "updated_at": stmt.excluded.updated_at},
    ))


def active_seconds(db: Session, batch_id: str, item_id: int, user_id: str) -> int:
    row = db.get(AuthorActiveTime, (batch_id, item_id, user_id))
    return row.seconds if row else 0


# --- sending queue -----------------------------------------------------------------

def claim_next_answer(db: Session) -> Optional[AuthorAnswer]:
    """Atomically take the oldest due answer waiting to be sent and mark it running."""
    row = db.execute(
        text(
            """
            SELECT id FROM author_identification_answers
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
    answer = db.get(AuthorAnswer, row[0])
    answer.sync_state = SYNC_RUNNING
    answer.sync_attempts += 1
    db.commit()
    return answer


def mark_synced(db: Session, answer_id: str) -> None:
    a = db.get(AuthorAnswer, answer_id)
    if a is None:
        return
    a.sync_state = SYNC_SUCCEEDED
    a.synced_at = datetime.utcnow()
    a.last_error = None
    a.next_attempt_at = None
    db.commit()


def mark_sync_failed(db: Session, answer_id: str, error: str, *, retriable: bool) -> None:
    """``retriable`` (BDRC unreachable, failing on its side, or refusing our login): try
    again later, every 6 hours once the backoff is used up. Otherwise BDRC refused the
    answer itself (unknown or withdrawn person, changed since, invalid): retrying cannot
    fix it, so it is failed for someone to look at."""
    a = db.get(AuthorAnswer, answer_id)
    if a is None:
        return
    a.last_error = error[:2000]
    if retriable:
        delay = RETRY_BACKOFF_SECONDS[min(a.sync_attempts - 1, len(RETRY_BACKOFF_SECONDS) - 1)]
        a.sync_state = SYNC_PENDING
        a.next_attempt_at = datetime.utcnow() + timedelta(seconds=delay)
    else:
        a.sync_state = SYNC_FAILED
        a.next_attempt_at = None
    db.commit()


def requeue_stale_running(db: Session, older_than_minutes: int = 30) -> int:
    """Answers left running by a restart mid-send go back to the queue."""
    cutoff = datetime.utcnow() - timedelta(minutes=older_than_minutes)
    stale = db.query(AuthorAnswer).filter(
        AuthorAnswer.sync_state == SYNC_RUNNING, AuthorAnswer.updated_at < cutoff
    ).all()
    for a in stale:
        a.sync_state = SYNC_PENDING
        a.next_attempt_at = None
        a.last_error = "Requeued: worker stopped mid-send"
    if stale:
        db.commit()
    return len(stale)


def sync_health(db: Session, limit: int = 50) -> dict[str, Any]:
    """Answers per sending state, and the latest ones BDRC refused."""
    counts = dict(db.execute(
        select(AuthorAnswer.sync_state, func.count()).group_by(AuthorAnswer.sync_state)
    ).all())
    failed = db.execute(
        select(AuthorAnswer)
        .where(AuthorAnswer.sync_state == SYNC_FAILED)
        .order_by(AuthorAnswer.updated_at.desc())
        .limit(limit)
    ).scalars().all()
    return {"counts": counts, "failed": failed}


# --- Duplicate reports ---------------------------------------------------------------------


def list_duplicates(db: Session) -> list[AuthorDuplicateReport]:
    return list(db.scalars(select(AuthorDuplicateReport).order_by(AuthorDuplicateReport.created_at.desc())))


def get_duplicate(db: Session, report_id: str) -> Optional[AuthorDuplicateReport]:
    return db.get(AuthorDuplicateReport, report_id)


def find_pair(db: Session, a: str, b: str) -> Optional[AuthorDuplicateReport]:
    """A report of these two persons, in either order, unless found to be different."""
    return db.scalars(
        select(AuthorDuplicateReport).where(
            ((AuthorDuplicateReport.person_id == a) & (AuthorDuplicateReport.other_id == b))
            | ((AuthorDuplicateReport.person_id == b) & (AuthorDuplicateReport.other_id == a)),
            (AuthorDuplicateReport.decision.is_(None)) | (AuthorDuplicateReport.decision != "different"),
        )
    ).first()


def duplicate_ids(db: Session, answer: AuthorAnswer) -> list[str]:
    """The other BDRC ids of the answer's persons, from the reports made on its text (those
    found to be different left out): what BDRC takes as ``data.duplicate_p_ids``."""
    mine = {p.get("p_id") for p in (answer.persons or []) if p.get("p_id")}
    if not mine:
        return []
    reports = db.scalars(
        select(AuthorDuplicateReport).where(
            AuthorDuplicateReport.batch_id == answer.batch_id,
            AuthorDuplicateReport.item_id == answer.item_id,
            (AuthorDuplicateReport.decision.is_(None)) | (AuthorDuplicateReport.decision != "different"),
        )
    )
    others: list[str] = []
    for r in reports:
        for this, other in ((r.person_id, r.other_id), (r.other_id, r.person_id)):
            if this in mine and other not in mine and other not in others:
                others.append(other)
    return others


def resend_current_answer(db: Session, batch_id: str, item_id: int) -> bool:
    """Send the text's current answer again (e.g. with a duplicate reported since). Not when
    it is still waiting or being sent: it will go with the change anyway."""
    answer = latest_answer(db, batch_id, item_id)
    if answer is None or answer.sync_state not in (SYNC_SUCCEEDED, SYNC_FAILED):
        return False
    answer.sync_state = SYNC_PENDING
    answer.sync_attempts = 0
    answer.next_attempt_at = None
    answer.last_error = None
    return True
