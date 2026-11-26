"""Handing texts out ("Assign work", 5 at a time, as in the Deduplicator) and listing a
person's texts with what BDRC has on each."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from author_identification import client
from author_identification import repository as repo
from author_identification.models import AuthorAssignment
from core.config import AUTHOR_IDENTIFICATION_BATCH_ID
from user.models.user import User

logger = logging.getLogger(__name__)

CLAIM_SIZE = 5
MAX_CLAIM_SIZE = 50


def _batch_items(batch_id: str, status: str | None = None) -> list[dict[str, Any]]:
    """Every item of a BDRC batch (in batch order), optionally of one status."""
    items: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = client.list_items(batch_id, status=status, offset=offset, limit=client.MAX_PAGE)
        rows = page.get("items") or []
        items.extend(rows)
        offset += len(rows)
        if not rows or offset >= page.get("total", 0):
            return items


def _view(db: Session, a: AuthorAssignment, item: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "batch_id": a.batch_id,
        "item_id": a.item_id,
        "assigned_at": a.assigned_at,
        "completed_at": a.completed_at,
        # BDRC's item (title, names found, ...); None if BDRC no longer lists it.
        "item": item,
        # The text's current answer saved here, or None.
        "answer": repo.latest_answer(db, a.batch_id, a.item_id),
    }


def my_texts(db: Session, user: User) -> list[dict[str, Any]]:
    """My texts, each with BDRC's item. One BDRC listing per batch I have texts in."""
    mine = repo.user_assignments(db, user.id)
    by_batch: dict[str, dict[int, dict[str, Any]]] = {}
    for batch_id in {a.batch_id for a in mine}:
        by_batch[batch_id] = {row["item_id"]: row for row in _batch_items(batch_id)}
    return [_view(db, a, by_batch.get(a.batch_id, {}).get(a.item_id)) for a in mine]


def claim(db: Session, user: User, size: int = CLAIM_SIZE) -> int:
    """Give me the next ``size`` texts of the batch being handed out: still open at BDRC
    and held by nobody here, in batch order. Someone with unfinished texts gets none: they
    finish those first. Returns how many were given."""
    if repo.user_assignments(db, user.id, open_only=True):
        return 0
    size = max(1, min(size, MAX_CLAIM_SIZE))
    batch_id = AUTHOR_IDENTIFICATION_BATCH_ID
    # Open at BDRC = no answer there yet. Texts handed out here but not answered (or not
    # yet sent) are still open there, so our own table is checked too.
    rows = _batch_items(batch_id, status="open")
    taken = repo.assigned_item_ids(db, batch_id, [r["item_id"] for r in rows])
    claimed = 0
    for row in rows:
        if claimed >= size:
            break
        if row["item_id"] in taken:
            continue
        if repo.try_assign(db, batch_id=batch_id, item_id=row["item_id"], user_id=user.id,
                           edition_id=row.get("edition_id")):
            claimed += 1
    db.commit()
    logger.info("author identification claim user=%s batch=%s claimed=%s", user.id, batch_id, claimed)
    return claimed
