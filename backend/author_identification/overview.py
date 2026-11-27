"""The admins' overview: how far each batch is, and each person's work."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from author_identification import client
from author_identification.client import EditionsApiError
from author_identification.deps import AUTHOR_IDENTIFICATION_PERMISSION, author_identification_role
from author_identification.models import AuthorAssignment, AuthorDuplicateReport
from author_identification.schemas import BatchProgressOut, OverviewOut, PersonProgressOut, WorkTotalsOut
from user.models.user import User

logger = logging.getLogger(__name__)

# BDRC statuses of a text that has an answer there.
_DONE_AT_BDRC = ("annotated", "reviewed")

# Per person, over all batches: texts handed out (finished or not), their current answers
# (persons given, or skipped), time on texts, and when they last did anything. A text's
# current answer is its newest one, whoever gave it.
_PEOPLE = text(
    """
    WITH current AS (
        SELECT DISTINCT ON (batch_id, item_id) batch_id, item_id, user_id, person_answer, text_rejected, decided_at
        FROM author_identification_answers
        ORDER BY batch_id, item_id, created_at DESC
    ),
    given AS (
        SELECT user_id, count(*) AS given, count(*) FILTER (WHERE completed_at IS NULL) AS in_progress,
               max(assigned_at) AS last_given
        FROM author_identification_assignments GROUP BY user_id
    ),
    answered AS (
        SELECT user_id,
               count(*) FILTER (WHERE NOT text_rejected AND person_answer IS DISTINCT FROM 'unknown') AS answered,
               count(*) FILTER (WHERE text_rejected OR person_answer = 'unknown') AS skipped,
               max(decided_at) AS last_answer
        FROM current GROUP BY user_id
    ),
    spent AS (
        SELECT user_id, sum(seconds) AS seconds, max(updated_at) AS last_seen
        FROM author_identification_active_time GROUP BY user_id
    )
    SELECT u.id AS user_id,
           coalesce(g.given, 0) AS given, coalesce(g.in_progress, 0) AS in_progress,
           coalesce(a.answered, 0) AS answered, coalesce(a.skipped, 0) AS skipped,
           coalesce(s.seconds, 0) AS seconds,
           greatest(g.last_given, a.last_answer, s.last_seen) AS last_activity
    FROM users u
    LEFT JOIN given g ON g.user_id = u.id
    LEFT JOIN answered a ON a.user_id = u.id
    LEFT JOIN spent s ON s.user_id = u.id
    WHERE g.user_id IS NOT NULL OR a.user_id IS NOT NULL OR s.user_id IS NOT NULL
       OR u.permissions::text LIKE :permission
    """
)


# Each text's current answer that was skipped, by why.
_SKIPPED = text(
    """
    SELECT CASE WHEN text_rejected THEN coalesce(reject_reason, 'text_not_clean') ELSE 'author_unknown' END AS reason,
           count(*) AS n
    FROM (
        SELECT DISTINCT ON (batch_id, item_id) text_rejected, reject_reason, person_answer
        FROM author_identification_answers
        ORDER BY batch_id, item_id, created_at DESC
    ) current
    WHERE text_rejected OR person_answer = 'unknown'
    GROUP BY 1
    """
)


def _skipped(db: Session) -> dict[str, int]:
    counts = {"author_unknown": 0, "text_not_clean": 0, "text_not_cropped": 0}
    for reason, n in db.execute(_SKIPPED).all():
        counts[reason] = counts.get(reason, 0) + n
    return counts


def _duplicates(db: Session) -> dict[str, int]:
    rows = dict(db.execute(
        select(AuthorDuplicateReport.decision, func.count()).group_by(AuthorDuplicateReport.decision)
    ).all())
    return {"to_check": rows.get(None, 0), "same": rows.get("same", 0), "different": rows.get("different", 0)}


def _batches(db: Session, current_batch: str) -> tuple[list[BatchProgressOut], str | None]:
    """Every batch at BDRC, oldest first, with the texts handed out of each here; when BDRC
    can't be reached, why."""
    try:
        listed: list[dict[str, Any]] = client.list_batches()
    except EditionsApiError as exc:
        logger.warning("author identification overview: batches from BDRC failed: %s", exc)
        return [], str(exc)
    handed_out = dict(db.execute(
        select(AuthorAssignment.batch_id, func.count()).group_by(AuthorAssignment.batch_id)
    ).all())
    rows = []
    for b in listed:
        batch_id = str(b.get("batch_id"))
        counts: dict[str, Any] = b.get("status_counts") or {}
        rows.append(BatchProgressOut(
            batch_id=batch_id,
            note=b.get("note"),
            created_at=b.get("created_at"),
            total=int(b.get("n_items") or sum(counts.values())),
            done=sum(int(counts.get(s) or 0) for s in _DONE_AT_BDRC),
            handed_out=handed_out.get(batch_id, 0),
            current=batch_id == current_batch,
        ))
    rows.sort(key=lambda r: ((r.created_at or datetime.max).isoformat(), r.batch_id))
    return rows, None


def overview(db: Session, current_batch: str) -> OverviewOut:
    rows = db.execute(_PEOPLE, {"permission": f"%{AUTHOR_IDENTIFICATION_PERMISSION}%"}).mappings().all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_([r["user_id"] for r in rows])).all()} if rows else {}
    people = [
        PersonProgressOut(
            user_id=r["user_id"],
            name=users[r["user_id"]].name if r["user_id"] in users else None,
            email=users[r["user_id"]].email if r["user_id"] in users else "",
            picture=users[r["user_id"]].picture if r["user_id"] in users else None,
            role=author_identification_role(users[r["user_id"]]) if r["user_id"] in users else "annotator",
            given=r["given"],
            in_progress=r["in_progress"],
            answered=r["answered"],
            skipped=r["skipped"],
            minutes=round(r["seconds"] / 60),
            last_activity=r["last_activity"],
        )
        for r in rows
    ]
    # Busiest first; those who haven't started yet at the end, by name.
    people.sort(key=lambda p: (-(p.answered + p.skipped + p.in_progress), -(p.last_activity or datetime.min).timestamp(), (p.name or p.email).lower()))
    batches, batch_error = _batches(db, current_batch)
    return OverviewOut(
        batches=batches,
        batch_error=batch_error,
        skipped_by_reason=_skipped(db),
        duplicates=_duplicates(db),
        totals=WorkTotalsOut(
            handed_out=sum(p.given for p in people),
            in_progress=sum(p.in_progress for p in people),
            answered=sum(p.answered for p in people),
            skipped=sum(p.skipped for p in people),
            minutes=sum(p.minutes for p in people),
        ),
        people=people,
    )
