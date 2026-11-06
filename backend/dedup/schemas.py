"""Request/response shapes for the dedup routes.

BDRC's review API validates none of its strings, so the vocabulary is enforced here
(review plan §5 decision / issue, §10 abstention reasons).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

Verdict = Literal["same", "different", "contains", "part_of", "source_dup", "not_sure"]
AbstentionReason = Literal[
    "insufficient_evidence",
    "genuinely_ambiguous",
    "out_of_scope",
    "technical_failure",
    "needs_image_or_metadata",
]
IssueKind = Literal[
    "outline_issue",
    "oversegmented",
    "undersegmented",
    "convention",
    "wrong_author",
    "author_conflict",
    "anthology_suspected",
    "source_dup",
    "other",
]


class IssueIn(BaseModel):
    kind: IssueKind
    mw_ids: list[str] = Field(min_length=1)
    note: Optional[str] = None


class DecisionIn(BaseModel):
    """What the review UI sends when an annotator answers an item.

    Every item ends with a verdict; issues (plan §5 ``issue``) are data problems
    reported alongside it, never instead of it. ``issues`` alone adds to an item that
    already has a verdict.

    ``issues`` is the item's full issue list (BDRC replaces the list on every write).
    Leave it out to keep the issues already recorded; the same goes for
    ``partner_payload`` (e.g. ``{"preferred_mw_id": "MW…"}`` for "which copy is better").
    """

    verdict: Optional[Verdict] = None
    abstention_reason: Optional[AbstentionReason] = None
    confidence: Optional[int] = Field(default=None, ge=1, le=5)
    issues: Optional[list[IssueIn]] = None
    partner_payload: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def _consistent(self) -> "DecisionIn":
        if self.verdict is None and "issues" not in self.model_fields_set:
            raise ValueError("send a verdict, or issues for an item that already has one")
        # Plan §5: CHECK ((verdict = 'not_sure') = (abstention_reason IS NOT NULL)).
        if self.verdict == "not_sure" and self.abstention_reason is None:
            raise ValueError("verdict 'not_sure' needs an abstention_reason")
        if self.verdict != "not_sure" and self.abstention_reason is not None:
            raise ValueError("abstention_reason is only allowed with verdict 'not_sure'")
        if self.confidence is not None and self.verdict is None:
            raise ValueError("confidence is only allowed with a verdict")
        return self


class AdjudicationIn(DecisionIn):
    """An adjudicator's answer: a decision, plus an optional note on why. Leave
    ``note`` out to keep the one already saved."""

    note: Optional[str] = Field(default=None, max_length=2000)


class CorrectionIn(DecisionIn):
    """An admin's correction of a pair's final answer, with an optional reason. Fields
    left out keep the current final answer's value (as for any decision)."""

    note: Optional[str] = Field(default=None, max_length=2000)


class AssignmentOut(BaseModel):
    slot: int = 1
    assigned_at: datetime
    first_opened_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    active_seconds: int = 0


class ActiveTimeIn(BaseModel):
    # One visit's worth; capped so a stuck tab cannot add hours in one call.
    seconds: int = Field(ge=1, le=3600)


class ItemOut(BaseModel):
    """A review item as the UI sees it: BDRC's evidence plus this user's latest decision.

    Field names match BDRC's review item so the UI can render either.
    """

    item_id: int
    batch_id: str
    kind: str
    subject: dict[str, Any]
    evidence: dict[str, Any]
    status: str
    verdict: Optional[str] = None
    abstention_reason: Optional[str] = None
    confidence: Optional[int] = None
    issues: Optional[list[dict[str, Any]]] = None
    partner_payload: Optional[dict[str, Any]] = None
    annotator_id: Optional[str] = None
    decided_at: Optional[datetime] = None
    sync_state: Optional[str] = None
    assignment: Optional[AssignmentOut] = None
    # When the assignee last changed their answer after first answering, and how many
    # times (saving the same answer again is not a change). The first answer's time is
    # assignment.completed_at.
    answer_changed_at: Optional[datetime] = None
    answer_changes: int = 0
    # "single" (answer is final) or "double" (two annotators, then an adjudicator if
    # they disagree).
    review_mode: str = "single"
    # Both annotators have answered, or an admin corrected the pair, so this answer can
    # no longer change.
    locked: bool = False
    # An admin corrected the pair's final answer (from the admin pair page).
    corrected: bool = False


class AnnotatorAnswerOut(BaseModel):
    """One annotator's answer, as the adjudicator sees it. ``label`` is "Annotator 1"
    or "Annotator 2" in an order shuffled per adjudicator; who answered is only shown
    to admins."""

    label: str
    verdict: Optional[str] = None
    abstention_reason: Optional[str] = None
    confidence: Optional[int] = None
    issues: Optional[list[dict[str, Any]]] = None
    partner_payload: Optional[dict[str, Any]] = None
    decided_at: Optional[datetime] = None
    slot: Optional[int] = None
    annotator_id: Optional[str] = None


class AdjudicationOut(BaseModel):
    created_at: datetime
    adjudicator_id: Optional[str] = None
    reserved_at: Optional[datetime] = None
    first_opened_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    resolution: Optional[str] = None
    active_seconds: int = 0


class AdjudicationItemOut(ItemOut):
    """A disputed pair: the evidence, both annotators' answers, and this adjudicator's
    own answer in the usual ``verdict``/``confidence``/... fields."""

    note: Optional[str] = None
    annotations: list[AnnotatorAnswerOut] = Field(default_factory=list)
    adjudication: AdjudicationOut


class PairOut(BaseModel):
    """A pair as anyone may see it from a shared link: the evidence only, never an
    answer (in double review, one annotator must not see the other's)."""

    item_id: int
    batch_id: str
    kind: str
    subject: dict[str, Any]
    evidence: dict[str, Any]


class DecisionHistoryOut(BaseModel):
    """One saved answer on a pair, as the admin pair page lists them."""

    user_id: str
    user_name: Optional[str] = None
    # annotator | adjudicator | admin_correction
    role: str
    slot: Optional[int] = None
    is_final: bool
    verdict: Optional[str] = None
    abstention_reason: Optional[str] = None
    confidence: Optional[int] = None
    issues: Optional[list[dict[str, Any]]] = None
    partner_payload: Optional[dict[str, Any]] = None
    note: Optional[str] = None
    decided_at: datetime
    sync_state: str


class TextSourceOut(BaseModel):
    """Where a text sits in a volume BDRC lists. Empty when BDRC gives no position."""

    source_volume_id: Optional[str] = None
    source_cstart: Optional[int] = None
    source_cend: Optional[int] = None


class PairSourcesOut(BaseModel):
    a: TextSourceOut = Field(default_factory=TextSourceOut)
    b: TextSourceOut = Field(default_factory=TextSourceOut)


class AdminPairOut(PairOut):
    """A pair on the admin correction page: the evidence, its current final answer and
    every answer ever saved on it. Never shown on the shared read-only page."""

    review_mode: str = "single"
    # False for a pair BDRC has but nobody has been handed yet: nothing to correct.
    handed_out: bool = True
    final: Optional[DecisionHistoryOut] = None
    history: list[DecisionHistoryOut] = Field(default_factory=list)
    corrected: bool = False


class AdminPairRow(BaseModel):
    """One pair in the admin pair list."""

    item_id: int
    batch_id: str
    title_a: Optional[str] = None
    title_b: Optional[str] = None
    review_mode: str = "single"
    # The current final answer; all None while the pair has none.
    verdict: Optional[str] = None
    abstention_reason: Optional[str] = None
    answered_by: Optional[str] = None
    answered_by_name: Optional[str] = None
    # annotator | adjudicator | admin_correction
    answered_role: Optional[str] = None
    decided_at: Optional[datetime] = None
    sync_state: Optional[str] = None
    corrected: bool = False
    # Everyone assigned to the pair (one or two annotators).
    annotator_names: list[str] = Field(default_factory=list)


class AdminPairListOut(BaseModel):
    total: int
    rows: list[AdminPairRow]


class BatchOut(BaseModel):
    batch_id: str
    kind: str = "pair"
    n_items: int = 0
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    # BDRC's counts for the whole batch, by status.
    status_counts: dict[str, int] = Field(default_factory=dict)
    my_open: int = 0
    my_done: int = 0


class ClaimOut(BaseModel):
    claimed: int
    """How many new items were handed out by this call (0 if the user still had open ones)."""
    items: list[ItemOut]


class SyncHealthOut(BaseModel):
    counts: dict[str, int]
    failed: list[dict[str, Any]]


# --- admin ---------------------------------------------------------------------------

class WorkCounts(BaseModel):
    assigned: int = 0
    done: int = 0
    in_progress: int = 0
    not_started: int = 0


class AdminBatchOut(BaseModel):
    batch_id: str
    n_items: int = 0
    created_at: Optional[datetime] = None
    # BDRC's counts for the whole batch, by status.
    status_counts: dict[str, int] = Field(default_factory=dict)
    # Handed out in the Cataloger, and how many of those are done (annotator slots).
    assigned: int = 0
    assigned_done: int = 0
    # Distinct pairs handed out to at least one annotator.
    pairs_handed_out: int = 0


class DoubleReviewCounts(BaseModel):
    """Double-review pairs by stage."""

    awaiting_second: int = 0
    both_answered: int = 0
    agreed: int = 0
    adjudication_waiting: int = 0
    adjudication_in_progress: int = 0
    adjudicated: int = 0
    # How adjudicated pairs were settled: sided_with_1 | sided_with_2 | new_label | unresolved.
    resolutions: dict[str, int] = Field(default_factory=dict)

class AdminOverviewOut(BaseModel):
    totals: WorkCounts
    batches: list[AdminBatchOut]
    # Current answer per decided item.
    verdicts: dict[str, int]
    abstention_reasons: dict[str, int]
    issues: dict[str, int]
    sync: SyncHealthOut
    double_review: DoubleReviewCounts



class AnnotatorOut(WorkCounts):
    user_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    picture: Optional[str] = None
    # admin | reviewer (shown as "Adjudicator") | annotator
    role: Optional[str] = None
    has_access: bool = True
    # Active time on screen: in total, and on average per answered pair.
    total_active_seconds: int = 0
    avg_active_seconds: Optional[float] = None
    last_active: Optional[datetime] = None
    # Double-review pairs where both annotators answered, and how many of those agreed.
    paired: int = 0
    agreed: int = 0
    # Pairs this person settled as adjudicator.
    adjudicated: int = 0
    # Pairs whose answer this person changed after first answering (in the period, if one
    # is chosen). Saving the same answer again is not a change.
    changed: int = 0
    # Their own current answer per pair they annotated, counted by verdict
    # (same | different | contains | part_of | source_dup | not_sure).
    answers: dict[str, int] = Field(default_factory=dict)


class ReassignIn(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=500)
    # Another annotator's id, or null to release the items back to the pool.
    to_user_id: Optional[str] = None
    # Whose slot moves (a pair has two). Without it, every unfinished slot on the items.
    from_user_id: Optional[str] = None


class SettingsOut(BaseModel):
    """Deduplicator-wide settings. ``review_mode``: how pairs handed out from now on are
    reviewed; pairs already handed out keep theirs."""

    review_mode: Literal["single", "double"] = "double"
    updated_by: Optional[str] = None
    updated_by_name: Optional[str] = None
    updated_at: Optional[datetime] = None


class SettingsIn(BaseModel):
    review_mode: Literal["single", "double"]


class AdjudicationReassignIn(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=500)
    # An adjudicator's id, or null to put the pairs back in the queue for anyone.
    to_user_id: Optional[str] = None


class AdminAdjudicationOut(BaseModel):
    item_id: int
    batch_id: str
    title_a: Optional[str] = None
    title_b: Optional[str] = None
    created_at: datetime
    adjudicator_id: Optional[str] = None
    adjudicator_name: Optional[str] = None
    reserved_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    resolution: Optional[str] = None
    verdict: Optional[str] = None
    annotations: list[AnnotatorAnswerOut] = Field(default_factory=list)


class ReassignOut(BaseModel):
    moved: list[int]
    # Already answered (they stay with whoever answered) or no longer assigned.
    skipped: list[int]
