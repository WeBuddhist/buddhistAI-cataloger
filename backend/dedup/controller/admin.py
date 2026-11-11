"""Admin views of dedup work: progress, per-annotator throughput and agreement,
reassigning annotator slots and adjudications, and correcting a pair's final answer."""
from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone
from functools import partial
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from dedup import client
from dedup.client import ReviewApiError
from dedup.controller.adjudication import annotations
from dedup.controller.dedup import _views_for, bdrc_error, get_pair, merged_fields, refresh_scan_ids
from dedup.deps import can_adjudicate, can_annotate, dedup_role, has_dedup_access
from dedup.models.dedup import (
    ADMIN_CORRECTED,
    MODE_SINGLE,
    ROLE_ADMIN_CORRECTION,
    SETTING_REVIEW_MODE,
    SYNC_PENDING,
    DedupAssignment,
    DedupDecision,
    DedupItem,
)
from dedup.repository import dedup_repository as repo
from dedup.schemas import (
    AdjudicationReassignIn,
    AdminAdjudicationOut,
    AdminBatchOut,
    AdminOverviewOut,
    AdminPairListOut,
    AdminPairOut,
    AdminPairRow,
    AnnotatorOut,
    CorrectionIn,
    DecisionHistoryOut,
    DoubleReviewCounts,
    ItemOut,
    ReassignIn,
    ReassignOut,
    SettingsIn,
    SettingsOut,
    SyncHealthOut,
    WorkCounts,
)
from user.models.user import User

logger = logging.getLogger(__name__)


def _state(a: DedupAssignment) -> str:
    if a.completed_at is not None:
        return "done"
    return "in_progress" if a.first_opened_at is not None else "not_started"


def _counts(assignments: list[DedupAssignment]) -> WorkCounts:
    c = Counter(_state(a) for a in assignments)
    return WorkCounts(assigned=len(assignments), done=c["done"], in_progress=c["in_progress"], not_started=c["not_started"])


def utc_naive(t: Optional[datetime]) -> Optional[datetime]:
    """Query-string times may carry an offset; the dedup tables store naive UTC."""
    if t is None or t.tzinfo is None:
        return t
    return t.astimezone(timezone.utc).replace(tzinfo=None)


def _in_period(t: Optional[datetime], since: Optional[datetime], until: Optional[datetime]) -> bool:
    """``until`` excluded; an unset end is open."""
    return t is not None and (since is None or t >= since) and (until is None or t < until)


def overview(db: Session, since: Optional[datetime] = None, until: Optional[datetime] = None) -> AdminOverviewOut:
    """With ``since``/``until`` (``until`` excluded), the work done in that period:
    pairs given out and answered, final answers, pairs both annotators finished, and
    adjudications settled. What is waiting now (opened, not opened, awaiting a second
    answer, adjudication waiting or under way), batch progress and sync stay as they are."""
    try:
        batches = client.list_batches()
        stats = client.batch_stats()
    except ReviewApiError as exc:
        raise bdrc_error(exc) from exc
    since, until = utc_naive(since), utc_naive(until)
    filtered = since is not None or until is not None
    in_period = partial(_in_period, since=since, until=until)

    ours = repo.assignment_counts_by_batch(db)
    decisions = repo.latest_decision_per_item(db)
    assignments = repo.all_assignments(db)
    totals = _counts(assignments)
    double_review = repo.double_review_counts(db)
    adjudications = repo.all_adjudications(db)
    if filtered:
        decisions = [d for d in decisions if in_period(d.decided_at)]
        totals.assigned = sum(1 for a in assignments if in_period(a.assigned_at))
        totals.done = sum(1 for a in assignments if in_period(a.completed_at))
        adjudications = [a for a in adjudications if in_period(a.completed_at)]
        # A pair counts as "both answered" on the day the second answer came in.
        finished_at = {(a.item_id, a.user_id): a.completed_at for a in assignments if a.completed_at}
        disputed = repo.disputed_item_ids(db)
        both = [
            item_id for item_id, uids in repo.answered_pairs(db)
            if all(finished_at.get((item_id, u)) for u in uids)
            and in_period(max(finished_at[(item_id, u)] for u in uids))
        ]
        double_review.update(
            both_answered=len(both),
            agreed=sum(1 for i in both if i not in disputed),
            adjudicated=len(adjudications),
        )

    verdicts = Counter(d.verdict for d in decisions if d.verdict)
    reasons = Counter(d.abstention_reason for d in decisions if d.abstention_reason)
    issues = Counter(i.get("kind") for d in decisions for i in (d.issues or []) if i.get("kind"))

    return AdminOverviewOut(
        totals=totals,
        batches=[
            AdminBatchOut(
                batch_id=b["batch_id"],
                n_items=b.get("n_items") or 0,
                created_at=b.get("created_at"),
                status_counts=stats.get(b["batch_id"], {}),
                assigned=ours.get(b["batch_id"], {}).get("assigned", 0),
                assigned_done=ours.get(b["batch_id"], {}).get("done", 0),
                pairs_handed_out=ours.get(b["batch_id"], {}).get("pairs", 0),
            )
            for b in sorted(batches, key=lambda b: (b.get("created_at") or "", b["batch_id"]))
        ],
        verdicts=dict(verdicts),
        abstention_reasons=dict(reasons),
        issues=dict(issues),
        sync=SyncHealthOut(**repo.sync_health(db)),
        double_review=DoubleReviewCounts(
            **double_review,
            resolutions=dict(Counter(a.resolution for a in adjudications if a.resolution)),
        ),
    )


def _dedup_users(db: Session) -> list[User]:
    rows = db.execute(select(User).where(User.permissions.ilike("%dedup%"))).scalars().all()
    return [u for u in rows if has_dedup_access(u)]


def annotators(
    db: Session, since: Optional[datetime] = None, until: Optional[datetime] = None
) -> list[AnnotatorOut]:
    """Everyone with dedup access, plus anyone still holding items after losing it.

    With ``since``/``until`` (``until`` excluded), answered (first answers), answers,
    changed, agreement, adjudicated and time count only that period; opened / not
    opened stay what is waiting now. A pair's time counts when it was answered (or
    settled), or when it was last worked on if it is not finished: time is stored as one
    total per pair.
    """
    since, until = utc_naive(since), utc_naive(until)
    filtered = since is not None or until is not None
    in_period = partial(_in_period, since=since, until=until)

    all_assignments = repo.all_assignments(db)
    by_user: dict[str, list[DedupAssignment]] = {}
    for a in all_assignments:
        by_user.setdefault(a.user_id, []).append(a)
    finished_at = {(a.item_id, a.user_id): a.completed_at for a in all_assignments if a.completed_at}
    all_adjudications = repo.all_adjudications(db)
    finished_at.update({(a.item_id, a.user_id): a.completed_at for a in all_adjudications if a.user_id and a.completed_at})

    last_answer = repo.last_decision_by_user(db)
    disputed = repo.disputed_item_ids(db, [a.item_id for a in all_adjudications])
    paired: Counter[str] = Counter()
    agreed: Counter[str] = Counter()
    for item_id, uids in repo.answered_pairs(db):
        for uid in uids:
            if filtered and not in_period(finished_at.get((item_id, uid))):
                continue
            paired[uid] += 1
            agreed[uid] += item_id not in disputed
    adjudicated = Counter(
        a.user_id for a in all_adjudications if a.completed_at and (not filtered or in_period(a.completed_at))
    )
    answers = repo.answer_counts_by_user(db, since, until)
    changed = Counter(
        uid for (_, uid), whens in repo.answer_changes(db).items() if any(not filtered or in_period(w) for w in whens)
    )
    time: dict[tuple[int, str], int] = {}
    total_by_user: dict[str, int] = {}
    for row in repo.all_active_time(db):
        if filtered and not in_period(finished_at.get((row.item_id, row.user_id)) or row.updated_at):
            continue
        time[(row.item_id, row.user_id)] = row.seconds
        total_by_user[row.user_id] = total_by_user.get(row.user_id, 0) + row.seconds
    users = {u.id: u for u in _dedup_users(db)}
    missing = (set(by_user) | set(total_by_user)) - set(users)
    if missing:
        users.update({u.id: u for u in db.execute(select(User).where(User.id.in_(missing))).scalars()})

    out = []
    for uid, u in users.items():
        mine = by_user.get(uid, [])
        # Includes time on pairs later moved to someone else: it was still this person's work.
        answered_time = [time[(a.item_id, uid)] for a in mine if a.completed_at and time.get((a.item_id, uid))]
        stamps = [t for a in mine for t in (a.assigned_at, a.first_opened_at, a.completed_at) if t]
        if uid in last_answer:
            stamps.append(last_answer[uid])
        counts = _counts(mine)
        if filtered:
            counts.done = sum(1 for a in mine if in_period(a.completed_at))
            counts.assigned = counts.done + counts.in_progress + counts.not_started
        out.append(
            AnnotatorOut(
                **counts.model_dump(),
                user_id=uid,
                name=u.name,
                email=u.email,
                picture=u.picture,
                role=dedup_role(u),
                has_access=has_dedup_access(u),
                total_active_seconds=total_by_user.get(uid, 0),
                avg_active_seconds=sum(answered_time) / len(answered_time) if answered_time else None,
                last_active=max(stamps) if stamps else None,
                paired=paired[uid],
                agreed=agreed[uid],
                adjudicated=adjudicated[uid],
                changed=changed[uid],
                answers=answers.get(uid, {}),
            )
        )
    out.sort(key=lambda r: (-r.assigned, (r.name or r.email or "").lower()))
    return out


def annotator_items(
    db: Session, user_id: str, state: str, since: Optional[datetime] = None, until: Optional[datetime] = None
) -> list[ItemOut]:
    """With ``since``/``until``, only the pairs this person first answered, or changed
    their answer on, in that period."""
    since, until = utc_naive(since), utc_naive(until)
    if since is None and until is None:
        return _views_for(db, repo.user_assignments(db, user_id, None, state=state))

    in_period = partial(_in_period, since=since, until=until)

    done = repo.user_assignments(db, user_id, None, state="done")
    changes = repo.answer_changes(db, [a.item_id for a in done])
    return _views_for(
        db,
        [
            a for a in done
            if in_period(a.completed_at) or any(in_period(w) for w in changes.get((a.item_id, user_id), []))
        ],
    )


def reassign(db: Session, admin: User, body: ReassignIn) -> ReassignOut:
    ids = list(dict.fromkeys(body.item_ids))
    if body.to_user_id is None:
        moved, skipped = repo.release(db, ids, body.from_user_id)
        action = "released"
    else:
        target: Optional[User] = db.get(User, body.to_user_id)
        if target is None or not has_dedup_access(target):
            raise HTTPException(status_code=400, detail="That user does not have access to the Deduplicator")
        if not can_annotate(target):
            raise HTTPException(status_code=400, detail="Adjudicators do not take annotation work")
        moved, skipped = repo.reassign(db, ids, target.id, admin.id, body.from_user_id)
        action = f"reassigned to {target.id}"
    db.commit()
    logger.info("dedup admin=%s %s items=%s skipped=%s", admin.id, action, moved, skipped)
    return ReassignOut(moved=moved, skipped=skipped)


# --- adjudication ------------------------------------------------------------------

def adjudications(db: Session, state: str = "all") -> list[AdminAdjudicationOut]:
    """Every disputed pair, with both answers and who gave them."""
    rows = repo.all_adjudications(db)
    if state == "open":
        rows = [a for a in rows if a.completed_at is None]
    elif state == "done":
        rows = [a for a in rows if a.completed_at is not None]
    ids = [a.item_id for a in rows]
    items = repo.get_items(db, ids)
    answers = repo.annotator_answers_for(db, ids)
    finals = repo.latest_adjudicator_decisions(db, ids)
    names = {
        u.id: u.name or u.email
        for u in db.execute(select(User).where(User.id.in_({a.user_id for a in rows if a.user_id}))).scalars()
    }
    return [
        AdminAdjudicationOut(
            item_id=a.item_id,
            batch_id=items[a.item_id].batch_id,
            title_a=((items[a.item_id].evidence or {}).get("a") or {}).get("title_bo"),
            title_b=((items[a.item_id].evidence or {}).get("b") or {}).get("title_bo"),
            created_at=a.created_at,
            adjudicator_id=a.user_id,
            adjudicator_name=names.get(a.user_id),
            reserved_at=a.reserved_at,
            completed_at=a.completed_at,
            resolution=a.resolution,
            verdict=finals[a.item_id].verdict if a.item_id in finals else None,
            annotations=annotations(a.item_id, answers[a.item_id]),
        )
        for a in rows
        if a.item_id in items
    ]


def reassign_adjudications(db: Session, admin: User, body: AdjudicationReassignIn) -> ReassignOut:
    """Hand unsettled disputed pairs to another adjudicator, or back to the queue.
    A pair is skipped if it is settled or the target annotated it."""
    target: Optional[User] = None
    if body.to_user_id is not None:
        target = db.get(User, body.to_user_id)
        if target is None or not can_adjudicate(target):
            raise HTTPException(status_code=400, detail="That user is not an adjudicator")
    moved, skipped = [], []
    now = datetime.utcnow()
    for item_id in dict.fromkeys(body.item_ids):
        adj = repo.get_adjudication(db, item_id, lock=True)
        if adj is None or adj.completed_at is not None or (
            target is not None and repo.get_assignment(db, item_id, target.id) is not None
        ):
            skipped.append(item_id)
            continue
        adj.user_id = target.id if target else None
        adj.reserved_at = now if target else None
        adj.first_opened_at = None
        moved.append(item_id)
    db.commit()
    logger.info("dedup admin=%s adjudications to=%s items=%s skipped=%s", admin.id, body.to_user_id, moved, skipped)
    return ReassignOut(moved=moved, skipped=skipped)


# --- settings ----------------------------------------------------------------------

def settings(db: Session) -> SettingsOut:
    s = repo.get_setting(db, SETTING_REVIEW_MODE)
    if s is None:
        return SettingsOut()
    who = db.get(User, s.updated_by) if s.updated_by else None
    return SettingsOut(
        review_mode=s.value,
        updated_by=s.updated_by,
        updated_by_name=(who.name or who.email) if who else None,
        updated_at=s.updated_at,
    )


def update_settings(db: Session, admin: User, body: SettingsIn) -> SettingsOut:
    """Takes effect on the next "Assign me work"; pairs already handed out keep theirs."""
    repo.set_setting(db, SETTING_REVIEW_MODE, body.review_mode, admin.id)
    db.commit()
    logger.info("dedup admin=%s review_mode=%s", admin.id, body.review_mode)
    return settings(db)


# --- correcting a pair -----------------------------------------------------------------

def list_pairs(db: Session, **filters) -> AdminPairListOut:
    """Handed-out pairs with their current final answer, for the admin pair list."""
    found, total = repo.search_pairs(db, **filters)
    ids = [item.item_id for item, _ in found]
    assignments = repo.assignments_for_items(db, ids)
    corrected = repo.corrected_item_ids(db, ids)
    user_ids = {a.user_id for a in assignments} | {d.user_id for _, d in found if d}
    names = {
        u.id: u.name or u.email or u.id
        for u in db.execute(select(User).where(User.id.in_(user_ids))).scalars()
    } if user_ids else {}
    assignees: dict[int, list[str]] = {}
    for a in sorted(assignments, key=lambda a: a.slot):
        assignees.setdefault(a.item_id, []).append(names.get(a.user_id, a.user_id))
    return AdminPairListOut(
        total=total,
        rows=[
            AdminPairRow(
                item_id=item.item_id,
                batch_id=item.batch_id,
                title_a=((item.evidence or {}).get("a") or {}).get("title_bo"),
                title_b=((item.evidence or {}).get("b") or {}).get("title_bo"),
                review_mode=item.review_mode,
                verdict=d.verdict if d else None,
                abstention_reason=d.abstention_reason if d else None,
                answered_by=d.user_id if d else None,
                answered_by_name=names.get(d.user_id) if d else None,
                answered_role=d.role if d else None,
                decided_at=d.decided_at if d else None,
                sync_state=d.sync_state if d else None,
                corrected=item.item_id in corrected,
                annotator_names=assignees.get(item.item_id, []),
            )
            for item, d in found
        ],
    )


def _pair_view(db: Session, item: DedupItem) -> AdminPairOut:
    history = repo.decision_history(db, item.item_id)
    slots = {a.user_id: a.slot for a in repo.item_assignments(db, item.item_id)}
    names = {
        u.id: u.name or u.email
        for u in db.execute(select(User).where(User.id.in_({d.user_id for d in history}))).scalars()
    }
    final = repo.final_decision(db, item.item_id)
    rows = {
        d.id: DecisionHistoryOut(
            user_id=d.user_id,
            user_name=names.get(d.user_id),
            role=d.role,
            slot=slots.get(d.user_id) if d.role != ROLE_ADMIN_CORRECTION else None,
            is_final=d.is_final,
            verdict=d.verdict,
            abstention_reason=d.abstention_reason,
            confidence=d.confidence,
            issues=d.issues,
            partner_payload=d.partner_payload,
            note=d.note,
            decided_at=d.decided_at,
            sync_state=d.sync_state,
        )
        for d in history
    }
    return AdminPairOut(
        item_id=item.item_id,
        batch_id=item.batch_id,
        kind=item.kind,
        subject=item.subject,
        evidence=item.evidence,
        review_mode=item.review_mode,
        final=rows[final.id] if final else None,
        history=list(rows.values()),
        corrected=any(d.role == ROLE_ADMIN_CORRECTION for d in history),
    )


def pair(db: Session, item_id: int) -> AdminPairOut:
    """A pair with its current final answer and every answer saved on it. A pair BDRC
    has but nobody has been handed yet comes with no answers."""
    item = repo.get_item(db, item_id)
    if item is None:
        return AdminPairOut(**get_pair(db, item_id).model_dump(), handed_out=False)
    refresh_scan_ids(db, item)
    return _pair_view(db, item)


def correct_pair(db: Session, admin: User, item_id: int, body: CorrectionIn) -> AdminPairOut:
    """Make the admin's answer the pair's final answer and queue it for BDRC.

    The earlier answers stay in the history. Nobody else can change the pair after
    this: unfinished annotator slots are released, an open adjudication is closed, and
    annotator and adjudicator saves are refused. The admin can correct again.
    """
    if repo.get_item(db, item_id) is None:
        try:
            row = client.get_item(item_id)
        except ReviewApiError as exc:
            raise bdrc_error(exc) from exc
        repo.upsert_item(db, row)
        # Nobody reviews it in the tool, so BDRC gets the admin's answer as it is.
        repo.set_mode_if_fresh(db, item_id, MODE_SINGLE)
    item = repo.get_item(db, item_id, lock=True)  # waits for an annotator's save in flight

    fields = merged_fields(repo.final_decision(db, item_id), body)
    now = datetime.utcnow()
    repo.add_decision(
        db,
        DedupDecision(
            item_id=item_id,
            user_id=admin.id,
            role=ROLE_ADMIN_CORRECTION,
            status="finalized",
            **fields,
            note=(body.note or "").strip() or None,
            decided_at=now,
            evidence_hash=item.evidence_hash,
            is_final=True,
            sync_state=SYNC_PENDING,
        ),
    )
    released, _ = repo.release(db, [item_id])
    adj = repo.get_adjudication(db, item_id, lock=True)
    if adj is not None and adj.completed_at is None:
        adj.completed_at = now
        adj.resolution = ADMIN_CORRECTED
    db.commit()
    logger.info(
        "dedup admin=%s corrected item=%s verdict=%s released_slots=%s",
        admin.id, item_id, fields["verdict"], len(released),
    )
    return _pair_view(db, item)
