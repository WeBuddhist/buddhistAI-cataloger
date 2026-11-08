"""Adjudication: settling double-review pairs whose two annotators disagree, and final
checks of pairs they answered alike when an admin queues those too.

Reviewers (shown as "Adjudicator") and admins adjudicate, never on a pair they
annotated. The first to open a pair takes it; their answer is final and is what BDRC
gets. They see both annotators' answers, unnamed and in an order shuffled per
adjudicator, so the answer rests on the texts rather than on who gave it.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from dedup.controller.dedup import CORRECTED_DETAIL, _item_view, merged_fields
from dedup.deps import can_adjudicate
from dedup.models.dedup import (
    CONFIRMED,
    NEW_LABEL,
    OVERRULED,
    ROLE_ADJUDICATOR,
    SIDED_WITH_1,
    SIDED_WITH_2,
    SYNC_PENDING,
    UNRESOLVED,
    DedupAdjudication,
    DedupDecision,
    DedupItem,
)
from dedup.repository import dedup_repository as repo
from dedup.schemas import AdjudicationIn, AdjudicationItemOut, AdjudicationOut, AnnotatorAnswerOut
from user.models.user import User

logger = logging.getLogger(__name__)


def _require(user: User) -> None:
    if not can_adjudicate(user):
        raise HTTPException(status_code=403, detail="Only adjudicators and admins settle disputed pairs")


def annotations(
    item_id: int, answers: dict[int, DedupDecision], viewer_id: Optional[str] = None
) -> list[AnnotatorAnswerOut]:
    """Both annotators' answers. For an adjudicator (``viewer_id``): unnamed, in an order
    fixed per adjudicator and pair but otherwise random. Without it (admin): by slot,
    with who answered."""
    slots = sorted(answers)
    if viewer_id is not None and hashlib.sha256(f"{item_id}:{viewer_id}".encode()).digest()[0] % 2:
        slots.reverse()
    return [
        AnnotatorAnswerOut(
            label=f"Annotator {n}",
            verdict=answers[s].verdict,
            abstention_reason=answers[s].abstention_reason,
            confidence=answers[s].confidence,
            issues=answers[s].issues,
            partner_payload=answers[s].partner_payload,
            decided_at=answers[s].decided_at,
            slot=None if viewer_id else s,
            annotator_id=None if viewer_id else answers[s].user_id,
        )
        for n, s in enumerate(slots, 1)
    ]


def _view(
    item: DedupItem,
    adj: DedupAdjudication,
    answers: dict[int, DedupDecision],
    viewer_id: str,
    decision: Optional[DedupDecision],
    active_seconds: int = 0,
    corrected: bool = False,
) -> AdjudicationItemOut:
    base = _item_view(item, decision, None, corrected=corrected)
    return AdjudicationItemOut(
        **base.model_dump(),
        note=decision.note if decision else None,
        annotations=annotations(item.item_id, answers, viewer_id),
        adjudication=AdjudicationOut(
            created_at=adj.created_at,
            adjudicator_id=adj.user_id,
            reserved_at=adj.reserved_at,
            first_opened_at=adj.first_opened_at,
            completed_at=adj.completed_at,
            resolution=adj.resolution,
            active_seconds=active_seconds,
        ),
    )


def queue(db: Session, user: User, state: str = "open") -> list[AdjudicationItemOut]:
    """Disputed pairs this person may settle (``open``), has settled (``done``), or both."""
    _require(user)
    adjs = repo.adjudication_queue(db, user.id, state)
    ids = [a.item_id for a in adjs]
    items = repo.get_items(db, ids)
    answers = repo.annotator_answers_for(db, ids)
    mine = {i: d for i, d in repo.latest_adjudicator_decisions(db, ids).items() if d.user_id == user.id}
    time = repo.active_seconds(db, user.id)
    corrected = repo.corrected_item_ids(db, ids)
    return [
        _view(
            items[a.item_id], a, answers[a.item_id], user.id, mine.get(a.item_id),
            time.get((a.item_id, user.id), 0), a.item_id in corrected,
        )
        for a in adjs
        if a.item_id in items
    ]


def _take(db: Session, user: User, item_id: int) -> tuple[DedupItem, DedupAdjudication]:
    """The disputed pair, taken by this user if nobody has it yet. Not committed."""
    adj = repo.get_adjudication(db, item_id, lock=True)
    item = repo.get_item(db, item_id)
    if adj is None or item is None:
        raise HTTPException(status_code=404, detail=f"Item {item_id} is not waiting for adjudication")
    if repo.get_assignment(db, item_id, user.id) is not None:
        raise HTTPException(status_code=403, detail="You annotated this pair, so someone else must adjudicate it")
    if adj.user_id is None:
        adj.user_id = user.id
        adj.reserved_at = datetime.utcnow()
    elif adj.user_id != user.id:
        raise HTTPException(status_code=409, detail="Another adjudicator has taken this pair")
    return item, adj


def get_item(db: Session, user: User, item_id: int) -> AdjudicationItemOut:
    """Open a disputed pair (taking it if free) and record when it was first opened."""
    _require(user)
    item, adj = _take(db, user, item_id)
    if adj.first_opened_at is None:
        adj.first_opened_at = datetime.utcnow()
    db.commit()
    decision = repo.latest_decision(db, item_id, user.id, ROLE_ADJUDICATOR)
    time = repo.active_seconds(db, user.id).get((item_id, user.id), 0)
    corrected = bool(repo.corrected_item_ids(db, [item_id]))
    return _view(item, adj, repo.annotator_answers(db, item_id), user.id, decision, time, corrected)


def _resolution(verdict: str, answers: dict[int, DedupDecision]) -> str:
    agreed = {d.verdict for d in answers.values()}
    if len(answers) == 2 and len(agreed) == 1 and "not_sure" not in agreed:
        # A final check: both annotators gave this pair the same answer.
        return CONFIRMED if verdict in agreed else OVERRULED
    if verdict == "not_sure":
        return UNRESOLVED
    if answers.get(1) is not None and verdict == answers[1].verdict:
        return SIDED_WITH_1
    if answers.get(2) is not None and verdict == answers[2].verdict:
        return SIDED_WITH_2
    return NEW_LABEL


def save_decision(db: Session, user: User, item_id: int, body: AdjudicationIn) -> AdjudicationItemOut:
    """Record the adjudicator's answer as the pair's final answer and queue it for
    BDRC. They may change it later, as annotators can; the newest answer wins."""
    _require(user)
    item, adj = _take(db, user, item_id)
    if repo.corrected_item_ids(db, [item_id]):
        raise HTTPException(status_code=409, detail=CORRECTED_DETAIL)
    answers = repo.annotator_answers(db, item_id)
    prev = repo.latest_decision(db, item_id, user.id, ROLE_ADJUDICATOR)
    fields = merged_fields(prev, body)

    note = body.note if "note" in body.model_fields_set else (prev.note if prev else None)
    # Optional, as in the plan's adjudication.notes: the adjudicator is trusted to decide.
    note = (note or "").strip() or None

    now = datetime.utcnow()
    decision = repo.add_decision(
        db,
        DedupDecision(
            item_id=item_id,
            user_id=user.id,
            role=ROLE_ADJUDICATOR,
            status="finalized",
            **fields,
            note=note,
            decided_at=now,
            evidence_hash=item.evidence_hash,
            is_final=True,
            sync_state=SYNC_PENDING,
        ),
    )
    adj.resolution = _resolution(fields["verdict"], answers)
    if adj.completed_at is None:
        adj.completed_at = now
    db.commit()
    db.refresh(decision)
    logger.info("dedup adjudicated item=%s user=%s verdict=%s resolution=%s", item_id, user.id, decision.verdict, adj.resolution)
    time = repo.active_seconds(db, user.id).get((item_id, user.id), 0)
    return _view(item, adj, answers, user.id, decision, time)
