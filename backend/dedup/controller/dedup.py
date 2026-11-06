"""Dedup review logic: batches, claiming work, reading items, recording decisions."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from dedup import client
from dedup.client import ReviewApiError
from dedup.deps import can_annotate, is_admin
from dedup.models.dedup import (
    MODE_DOUBLE,
    ROLE_ADJUDICATOR,
    ROLE_ADMIN_CORRECTION,
    ROLE_ANNOTATOR,
    SYNC_LOCAL,
    SYNC_PENDING,
    DedupAssignment,
    DedupDecision,
    DedupItem,
)
from dedup.repository import dedup_repository as repo
from dedup.schemas import AssignmentOut, BatchOut, ClaimOut, DecisionIn, ItemOut, PairOut, PairSourcesOut, TextSourceOut
from user.models.user import User

logger = logging.getLogger(__name__)

# Items handed out per claim. An annotator gets more only after finishing these. Kept
# small so pairs reach their second annotator, and get settled, sooner.
CLAIM_SIZE = 5
MAX_CLAIM_SIZE = 50


def bdrc_error(exc: ReviewApiError) -> HTTPException:
    """Pass BDRC's 404 through; anything else is a gateway error on our side."""
    if exc.status_code == 404:
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=502, detail=str(exc))


CORRECTED_DETAIL = "An admin corrected this pair, so its answer can no longer be changed here"


# --- views -------------------------------------------------------------------------

def _item_view(
    item: DedupItem,
    decision: Optional[DedupDecision],
    assignment: Optional[DedupAssignment],
    active_seconds: int = 0,
    locked: bool = False,
    corrected: bool = False,
    changes: Optional[list[datetime]] = None,
) -> ItemOut:
    return ItemOut(
        item_id=item.item_id,
        batch_id=item.batch_id,
        kind=item.kind,
        subject=item.subject,
        evidence=item.evidence,
        status=decision.status if decision else "new",
        verdict=decision.verdict if decision else None,
        abstention_reason=decision.abstention_reason if decision else None,
        confidence=decision.confidence if decision else None,
        issues=decision.issues if decision else None,
        partner_payload=decision.partner_payload if decision else None,
        annotator_id=decision.user_id if decision else None,
        decided_at=decision.decided_at if decision else None,
        sync_state=decision.sync_state if decision else None,
        assignment=(
            AssignmentOut(
                slot=assignment.slot,
                assigned_at=assignment.assigned_at,
                first_opened_at=assignment.first_opened_at,
                completed_at=assignment.completed_at,
                active_seconds=active_seconds,
            )
            if assignment
            else None
        ),
        review_mode=item.review_mode,
        locked=locked or corrected,
        corrected=corrected,
        answer_changed_at=changes[-1] if changes else None,
        answer_changes=len(changes or []),
    )


def _is_locked(item: DedupItem, answered: int) -> bool:
    """A double-review answer is fixed once both annotators have answered."""
    return item.review_mode == MODE_DOUBLE and answered >= 2


def _views_for(db: Session, assignments: list[DedupAssignment]) -> list[ItemOut]:
    """Each assignee's own answer only: annotators never see each other's."""
    ids = [a.item_id for a in assignments]
    items = repo.get_items(db, ids)
    decisions = repo.latest_decisions(db, ids)
    answered = repo.answered_counts(db, ids)
    corrected = repo.corrected_item_ids(db, ids)
    owners = {a.user_id for a in assignments}
    time = repo.active_seconds(db, next(iter(owners))) if len(owners) == 1 else repo.active_seconds(db)
    changes = repo.answer_changes(db, ids)
    return [
        _item_view(
            items[a.item_id],
            decisions.get((a.item_id, a.user_id)),
            a,
            time.get((a.item_id, a.user_id), 0),
            _is_locked(items[a.item_id], answered.get(a.item_id, 0)),
            a.item_id in corrected,
            changes.get((a.item_id, a.user_id)),
        )
        for a in assignments
        if a.item_id in items
    ]


# --- batches -----------------------------------------------------------------------

def list_batches(db: Session, user: User) -> list[BatchOut]:
    try:
        batches = client.list_batches()
        stats = client.batch_stats()
    except ReviewApiError as exc:
        raise bdrc_error(exc) from exc
    mine = repo.user_counts_by_batch(db, user.id)
    return [
        BatchOut(
            batch_id=b["batch_id"],
            kind=b.get("kind") or "pair",
            n_items=b.get("n_items") or 0,
            notes=b.get("notes"),
            created_at=b.get("created_at"),
            status_counts=stats.get(b["batch_id"], {}),
            my_open=mine.get(b["batch_id"], {}).get("open", 0),
            my_done=mine.get(b["batch_id"], {}).get("done", 0),
        )
        for b in batches
    ]


# --- claiming ------------------------------------------------------------------------

def _claim_second_slots(db: Session, user: User, batch_id: Optional[str], need: int) -> int:
    """Take the free slot on pairs another annotator already holds. Not committed."""
    claimed = 0
    for item_id, bid, slot in repo.open_second_slots(db, user.id, batch_id, need):
        if repo.try_assign(db, item_id=item_id, batch_id=bid, user_id=user.id, assigned_by=user.id, slot=slot):
            claimed += 1
    return claimed


def _claim_from_batch(db: Session, user: User, batch_id: str, need: int, mode: str) -> int:
    """Take slot 1 on up to ``need`` pairs of ``batch_id`` nobody holds, reviewed in
    ``mode``. Not committed."""
    claimed = 0
    offset = 0
    while claimed < need:
        try:
            # `new` = untouched in BDRC. Pairs this tool has handed out but that are not
            # settled yet are still `new` there, so they are skipped via our own table.
            page = client.list_items(batch_id, status="new", offset=offset, limit=client.MAX_PAGE)
        except ReviewApiError as exc:
            db.rollback()
            raise bdrc_error(exc) from exc
        rows = page.get("items") or []
        if not rows:
            break
        ids = [r["item_id"] for r in rows]
        # An admin's correction may not have reached BDRC yet.
        taken = repo.assigned_item_ids(db, ids) | repo.corrected_item_ids(db, ids)
        for row in rows:
            if claimed >= need:
                break
            if row["item_id"] in taken:
                continue
            repo.upsert_item(db, row)
            repo.set_mode_if_fresh(db, row["item_id"], mode)
            if repo.try_assign(
                db, item_id=row["item_id"], batch_id=batch_id, user_id=user.id, assigned_by=user.id
            ):
                claimed += 1
        offset += len(rows)
        if offset >= (page.get("total") or 0):
            break
    return claimed


def _batches_oldest_first() -> list[str]:
    try:
        batches = client.list_batches()
    except ReviewApiError as exc:
        raise bdrc_error(exc) from exc
    batches.sort(key=lambda b: (b.get("created_at") or "", b["batch_id"]))
    return [b["batch_id"] for b in batches]


def claim_items(
    db: Session, user: User, batch_id: Optional[str] = None, size: int = CLAIM_SIZE
) -> ClaimOut:
    """Hand the user their next ``size`` pairs.

    Pairs waiting for a second annotator come first, picked at random, so pairs get
    finished rather than piling up half done. The rest are fresh pairs from the oldest
    batch with unclaimed items, running into the next batch if it empties mid-claim,
    reviewed the way the admin set (single or double). A user who still has unfinished
    items gets those back instead.
    """
    if not can_annotate(user):
        raise HTTPException(status_code=403, detail="Adjudicators settle disputed pairs and do not take annotation work")
    size = max(1, min(size, MAX_CLAIM_SIZE))
    open_now = repo.user_assignments(db, user.id, batch_id, state="open")
    if open_now:
        return ClaimOut(claimed=0, items=_views_for(db, open_now))

    claimed = _claim_second_slots(db, user, batch_id, size)
    if claimed < size:
        mode = repo.review_mode(db)
        for bid in [batch_id] if batch_id else _batches_oldest_first():
            claimed += _claim_from_batch(db, user, bid, size - claimed, mode)
            if claimed >= size:
                break

    db.commit()
    logger.info("dedup claim user=%s batch=%s claimed=%s", user.id, batch_id or "auto", claimed)
    return ClaimOut(claimed=claimed, items=_views_for(db, repo.user_assignments(db, user.id, batch_id, state="open")))


def my_items(db: Session, user: User, batch_id: Optional[str] = None, state: str = "all") -> list[ItemOut]:
    return _views_for(db, repo.user_assignments(db, user.id, batch_id, state=state))


# --- one item ------------------------------------------------------------------------

def _load_owned(
    db: Session, user: User, item_id: int, *, lock: bool = False
) -> tuple[DedupItem, Optional[DedupAssignment]]:
    """The item and the user's slot on it, if they may see it (assignee or admin; an
    admin who holds no slot gets ``None`` for the assignment)."""
    item = repo.get_item(db, item_id)
    assignment = repo.get_assignment(db, item_id, user.id, lock=lock) if item else None
    if assignment is not None or (item is not None and is_admin(user)):
        return item, assignment
    if item is None or not repo.item_assignments(db, item_id):
        raise HTTPException(status_code=404, detail=f"Item {item_id} is not assigned")
    raise HTTPException(status_code=403, detail="This item is assigned to someone else")


def get_pair(db: Session, item_id: int) -> PairOut:
    """A pair's evidence for the read-only shared page. Pairs nobody has claimed yet are
    read from BDRC without being stored."""
    item = repo.get_item(db, item_id)
    if item is not None:
        return PairOut(item_id=item.item_id, batch_id=item.batch_id, kind=item.kind, subject=item.subject, evidence=item.evidence)
    try:
        row = client.get_item(item_id)
    except ReviewApiError as exc:
        raise bdrc_error(exc) from exc
    return PairOut(
        item_id=row["item_id"],
        batch_id=row["batch_id"],
        kind=row.get("kind") or "pair",
        subject=row.get("subject") or {},
        evidence=row.get("evidence") or {},
    )


def get_pair_sources(db: Session, item_id: int) -> PairSourcesOut:
    """Where the pair's two texts sit in their volumes. Pairs stored before BDRC added
    these fields keep their evidence as first seen, so theirs are read from BDRC."""
    item = repo.get_item(db, item_id)
    evidence = item.evidence if item is not None else {}
    if "source_cstart" not in (evidence.get("a") or {}):
        try:
            evidence = client.get_item(item_id).get("evidence") or {}
        except ReviewApiError as exc:
            raise bdrc_error(exc) from exc

    def source(side: str) -> TextSourceOut:
        card = evidence.get(side) or {}
        return TextSourceOut(
            source_volume_id=card.get("source_volume_id"),
            source_cstart=card.get("source_cstart"),
            source_cend=card.get("source_cend"),
        )

    return PairSourcesOut(a=source("a"), b=source("b"))


def get_item(db: Session, user: User, item_id: int) -> ItemOut:
    item, assignment = _load_owned(db, user, item_id)
    if assignment is None:  # an admin looking at someone else's pair: no answer to show
        return _item_view(item, None, None)
    repo.mark_opened(db, assignment)
    db.commit()
    locked = _is_locked(item, repo.answered_counts(db, [item_id]).get(item_id, 0))
    corrected = bool(repo.corrected_item_ids(db, [item_id]))
    return _item_view(item, repo.latest_decision(db, item_id, user.id), assignment, locked=locked, corrected=corrected)


def add_active_time(db: Session, user: User, item_id: int, seconds: int) -> None:
    if not repo.add_active_seconds(db, item_id, user.id, seconds):
        raise HTTPException(status_code=403, detail="This item is not assigned to you")
    db.commit()


def merged_fields(prev: Optional[DedupDecision], body: DecisionIn) -> dict[str, Any]:
    """The answer to save: fields not sent keep their previous value, the same as
    BDRC's partial PUT, so reporting an issue does not wipe the verdict and omitting
    ``issues`` keeps the list."""
    sent = body.model_fields_set
    if body.verdict is not None:
        fields = {"verdict": body.verdict, "abstention_reason": body.abstention_reason, "confidence": body.confidence}
    elif prev is not None and prev.verdict is not None:  # issues only: keep the verdict
        fields = {"verdict": prev.verdict, "abstention_reason": prev.abstention_reason, "confidence": prev.confidence}
    else:
        # Plan §5: an issue sits beside the decision, never replaces it.
        raise HTTPException(status_code=422, detail="Answer the pair before reporting a data problem")

    if "issues" in sent:
        fields["issues"] = [i.model_dump() for i in body.issues] if body.issues else None
    else:
        fields["issues"] = prev.issues if prev else None
    fields["partner_payload"] = body.partner_payload if "partner_payload" in sent else (prev.partner_payload if prev else None)
    return fields


def _settle(db: Session, item: DedupItem, decision: DedupDecision) -> None:
    """Once both annotators have answered: the same verdict is final (the answer that
    completed the pair is queued for BDRC); anything else, including any "can't
    answer", goes to adjudication."""
    answers = repo.annotator_answers(db, item.item_id)
    if len(answers) < 2:
        return
    first, second = answers[1].verdict, answers[2].verdict
    if first == second and first != "not_sure":
        repo.supersede_pending(db, item.item_id)
        decision.is_final = True
        decision.sync_state = SYNC_PENDING
        logger.info("dedup item=%s agreed verdict=%s", item.item_id, first)
    else:
        repo.open_adjudication(db, item.item_id)
        logger.info("dedup item=%s disputed %s vs %s", item.item_id, first, second)


def save_decision(db: Session, user: User, item_id: int, body: DecisionIn) -> ItemOut:
    """Record a decision locally; on a single-review item, or when two annotators
    agree, queue the final answer for BDRC."""
    item, assignment = _load_owned(db, user, item_id, lock=True)
    if assignment is None:
        raise HTTPException(status_code=403, detail="Only the assigned annotator can decide this item")
    if repo.corrected_item_ids(db, [item_id]):
        raise HTTPException(status_code=409, detail=CORRECTED_DETAIL)

    double = item.review_mode == MODE_DOUBLE
    if double:
        repo.get_item(db, item_id, lock=True)  # the two annotators' saves take turns
        if _is_locked(item, repo.answered_counts(db, [item_id]).get(item_id, 0)):
            raise HTTPException(status_code=409, detail="Both answers are in, so this pair can no longer be changed")

    prev = repo.latest_decision(db, item_id, user.id)
    now = datetime.utcnow()
    decision = repo.add_decision(
        db,
        DedupDecision(
            item_id=item_id,
            user_id=user.id,
            role=ROLE_ANNOTATOR,
            # Every saved decision has a verdict, so BDRC always gets it finalized;
            # any issues travel alongside in `issues`.
            status="finalized",
            **merged_fields(prev, body),
            decided_at=now,
            evidence_hash=item.evidence_hash,
            # Double review: kept here until the pair is settled.
            is_final=not double,
            sync_state=SYNC_LOCAL if double else SYNC_PENDING,
        ),
    )
    if double:
        _settle(db, item, decision)
    # Answered, so the annotator is done with it; it no longer blocks a new claim.
    if assignment.completed_at is None:
        assignment.completed_at = now
    db.commit()
    db.refresh(decision)
    locked = _is_locked(item, repo.answered_counts(db, [item_id]).get(item_id, 0))
    return _item_view(item, decision, assignment, locked=locked)


# --- the answer BDRC gets ----------------------------------------------------------------

def _answer_summary(d: DedupDecision, slot: int) -> dict[str, Any]:
    return {
        "slot": slot,
        "annotator_id": d.user_id,
        "verdict": d.verdict,
        "abstention_reason": d.abstention_reason,
        "confidence": d.confidence,
        "issues": d.issues,
        "partner_payload": d.partner_payload,
        "decided_at": d.decided_at.isoformat() + "Z",
    }


def _union_issues(*lists: Optional[list[dict[str, Any]]]) -> Optional[list[dict[str, Any]]]:
    seen: dict[str, dict[str, Any]] = {}
    for issues in lists:
        for i in issues or []:
            seen.setdefault(json.dumps(i, sort_keys=True, ensure_ascii=False), i)
    return list(seen.values()) or None


def bdrc_payload(db: Session, decision: DedupDecision) -> dict[str, Any]:
    """The PUT body for BDRC. Every writable field is sent, so BDRC ends up holding
    exactly the final answer (e.g. an old abstention_reason is cleared).

    On a double-review pair the final answer is the two annotators' shared verdict, the
    adjudicator's, or an admin's correction; ``partner_payload.review`` records how it
    was reached and every answer behind it.
    """
    payload = {
        "status": decision.status,
        "verdict": decision.verdict,
        "abstention_reason": decision.abstention_reason,
        "confidence": decision.confidence,
        "issues": decision.issues,
        "annotator_id": decision.user_id,
        "decided_at": decision.decided_at.isoformat() + "Z",
        "partner_payload": decision.partner_payload,
    }
    item = repo.get_item(db, decision.item_id)
    if item is None or item.review_mode != MODE_DOUBLE:
        return payload

    answers = repo.annotator_answers(db, decision.item_id)
    review: dict[str, Any] = {"annotations": [_answer_summary(d, s) for s, d in sorted(answers.items())]}
    if decision.role == ROLE_ADMIN_CORRECTION:
        review.update(resolution="admin_corrected", corrected_by=decision.user_id, note=decision.note)
    elif decision.role == ROLE_ADJUDICATOR:
        adjudication = repo.get_adjudication(db, decision.item_id)
        review.update(
            resolution="adjudicated",
            adjudicator_id=decision.user_id,
            outcome=adjudication.resolution if adjudication else None,
            note=decision.note,
        )
    else:
        both = list(answers.values())
        confidences = [d.confidence for d in both if d.confidence is not None]
        preferred = {(d.partner_payload or {}).get("preferred_mw_id") for d in both}
        payload.update(
            confidence=min(confidences) if confidences else None,
            issues=_union_issues(*(d.issues for d in both)),
            # A preferred copy only when both annotators picked the same one.
            partner_payload={"preferred_mw_id": preferred.pop()} if len(preferred) == 1 and None not in preferred else None,
        )
        review["resolution"] = "agreed"
    payload["partner_payload"] = {**(payload["partner_payload"] or {}), "review": review}
    return payload
