"""Pydantic models for legacy ``/outliner/*`` routes."""

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator


class SegmentRejectionReviewer(BaseModel):
    """Latest reviewer for a rejected segment (document + segment APIs)."""

    user_id: str
    picture: Optional[str] = None
    name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @model_serializer(mode="wrap")
    def _serialize_omit_nulls(self, serializer):
        data = serializer(self)
        if not isinstance(data, dict):
            return data
        return {k: v for k, v in data.items() if v is not None}


# Same shape as SegmentRejectionReviewer; used for annotator/reviewed-by on segment payloads.
SegmentAttributionUser = SegmentRejectionReviewer


class MarkedSpan(BaseModel):
    """One stretch of wrong text a reviewer marked, in document-absolute offsets."""

    start: int = Field(..., ge=0)
    end: int = Field(..., ge=0)
    note: Optional[str] = Field(
        None, description="Optional per-mark explanation; the rejection comment covers the rest"
    )

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.end <= self.start:
            raise ValueError("Marked span end must be greater than start")
        return self


class SegmentRejectionSummary(BaseModel):
    """Bundled rejection fields for segment payloads (avoid flat rejection_* keys)."""

    count: int = 0
    reason: Optional[str] = None
    reviewer: Optional[SegmentRejectionReviewer] = None
    resolved: Optional[bool] = None
    marked_spans: Optional[List[MarkedSpan]] = None
    # Reviewer's title/author suggestion at reject time (only while still rejected).
    reviewer_title: Optional[str] = None
    reviewer_author: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @model_serializer(mode="wrap")
    def _serialize_omit_nulls(self, serializer):
        data = serializer(self)
        if not isinstance(data, dict):
            return data
        return {k: v for k, v in data.items() if v is not None}


class SegmentRejectionHistoryItem(BaseModel):
    """One row from segment_rejections (admin rejection history modal)."""

    id: str
    created_at: datetime
    reason: Optional[str] = None
    resolved: Optional[bool] = None
    reviewer: Optional[SegmentRejectionReviewer] = None
    marked_spans: Optional[List[MarkedSpan]] = None
    reviewer_title: Optional[str] = None
    reviewer_author: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @model_serializer(mode="wrap")
    def _serialize_omit_nulls(self, serializer):
        data = serializer(self)
        if not isinstance(data, dict):
            return data
        return {k: v for k, v in data.items() if v is not None}


class SegmentRejectionHistoryResponse(BaseModel):
    items: List[SegmentRejectionHistoryItem] = Field(default_factory=list)


class SegmentCreate(BaseModel):
    text: Optional[str] = None  # Optional - will be extracted from document if not provided
    segment_index: int
    span_start: int
    span_end: int
    title: Optional[str] = None
    author: Optional[str] = None
    title_bdrc_id: Optional[str] = None
    author_bdrc_id: Optional[str] = None
    parent_segment_id: Optional[str] = None


class CommentAdd(BaseModel):
    content: str
    username: str


class CommentUpdate(BaseModel):
    content: str


class CommentResponse(BaseModel):
    content: str
    username: str
    timestamp: str


class CommentsResponse(BaseModel):
    comments: List[CommentResponse]


class SegmentUpdate(BaseModel):
    text: Optional[str] = None
    title: Optional[str] = None
    author: Optional[str] = None
    title_bdrc_id: Optional[str] = None
    author_bdrc_id: Optional[str] = None
    parent_segment_id: Optional[str] = None
    is_attached: Optional[bool] = None
    status: Optional[str] = None  # checked, unchecked
    label: Optional[str] = None  # FRONT_MATTER, TOC, TEXT, BACK_MATTER
    comment: Optional[str] = None  # Deprecated: kept for backward compatibility
    comment_content: Optional[str] = None  # New comment content to append
    comment_username: Optional[str] = None  # Username for new comment
    is_supplied_title: Optional[bool] = None  # Title supplied by annotator (not from source)
    title_span_start: Optional[int] = None
    title_span_end: Optional[int] = None
    updated_title: Optional[str] = None  # Annotator text when it differs from source span text
    author_span_start: Optional[int] = None
    author_span_end: Optional[int] = None
    updated_author: Optional[str] = None
    reviewer_title: Optional[str] = None
    reviewer_author: Optional[str] = None


class SegmentResponse(BaseModel):
    id: str
    text: Optional[str] = None  # Omitted in JSON; derive from document.content + spans
    segment_index: int
    span_start: int
    span_end: int
    title: Optional[str] = None
    author: Optional[str] = None
    title_span_start: Optional[int] = None
    title_span_end: Optional[int] = None
    updated_title: Optional[str] = None
    author_span_start: Optional[int] = None
    author_span_end: Optional[int] = None
    updated_author: Optional[str] = None
    reviewer_title: Optional[str] = None
    reviewer_author: Optional[str] = None
    title_bdrc_id: Optional[str] = None
    author_bdrc_id: Optional[str] = None
    parent_segment_id: Optional[str] = None
    is_annotated: bool
    is_attached: Optional[bool] = None
    status: Optional[str] = None
    label: Optional[str] = None  # FRONT_MATTER, TOC, TEXT, BACK_MATTER
    rejection: Optional[SegmentRejectionSummary] = None
    is_supplied_title: Optional[bool] = None
    comments: Optional[List[CommentResponse]] = None
    created_at: datetime
    updated_at: datetime
    reviewed_by: Optional[SegmentAttributionUser] = None
    reviewed_at: Optional[datetime] = None
    annotator: Optional[SegmentAttributionUser] = None
    # Set when the reviewer added this segment during review (NULL = the annotator's).
    created_by_id: Optional[str] = None
    # The reviewer split/merged this annotator segment.
    corrected_by_reviewer: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)

    @model_serializer(mode="wrap")
    def _serialize_omit_empty_text(self, serializer):
        data = serializer(self)
        if isinstance(data, dict) and data.get("text") is None:
            data.pop("text", None)
        return data


class RejectSegmentRequest(BaseModel):
    comment: str = Field(..., min_length=1, description="Required explanation for the annotator")
    marked_spans: Optional[List[MarkedSpan]] = Field(
        None,
        description="Optional stretches of wrong text inside the segment (document-absolute offsets)",
    )


class SegmentReviewRequest(BaseModel):
    """Reviewer's approve/reject decision on a segment from the view-only page."""

    status: Literal["approve", "reject"]
    comment: str | None = None


class SanityCheckSegmentInput(BaseModel):
    """One segment span to run through the sanity-check linter, as currently shown in the editor."""

    id: str
    start: int = Field(..., description="Character offset into the document text (inclusive)")
    end: int = Field(..., description="Character offset into the document text (exclusive)")
    label: Optional[str] = Field(
        None, description="Segment label, e.g. TEXT; only TEXT segments are checked"
    )


class SanityCheckRequest(BaseModel):
    """Segment spans to sanity-check. Sent by the frontend so the check reflects exactly
    what's currently in the editor, rather than re-reading (possibly stale) DB rows."""

    segments: List[SanityCheckSegmentInput]


class SubmitToBdrcRequest(BaseModel):
    """Annotator's submit-to-review decision, including whether the scan is complete."""

    is_complete: bool = Field(
        True,
        description="False when the scanned volume is missing pages at the beginning and/or end",
    )
    ignore_sanity_warnings: bool = Field(
        False,
        description="Skip the segmentation sanity-check gate (annotator chose to submit despite warnings)",
    )


class SegmentReviewResponse(BaseModel):
    id: str
    document_id: str
    segment_id: str
    user_id: str
    status: str
    comment: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SegmentReviewStatusItem(BaseModel):

    segment_id: str
    status: str


class SegmentReviewsResponse(BaseModel):

    document_id: str
    items: List[SegmentReviewStatusItem] = Field(default_factory=list)


class BulkRejectRequest(BaseModel):
    segment_ids: List[str]
    comment: str = Field(
        ...,
        min_length=1,
        description="Required explanation for the annotator (applied to each segment)",
    )


class DocumentCreate(BaseModel):
    content: str
    filename: Optional[str] = None


class SegmentResponseDocument(BaseModel):
    id: str
    text: Optional[str] = None  # Omitted in JSON; derive from document.content + spans
    segment_index: int
    span_start: int
    span_end: int
    title: Optional[str] = None
    author: Optional[str] = None
    title_span_start: Optional[int] = None
    title_span_end: Optional[int] = None
    updated_title: Optional[str] = None
    author_span_start: Optional[int] = None
    author_span_end: Optional[int] = None
    updated_author: Optional[str] = None
    reviewer_title: Optional[str] = None
    reviewer_author: Optional[str] = None
    title_bdrc_id: Optional[str] = None
    author_bdrc_id: Optional[str] = None
    parent_segment_id: Optional[str] = None
    is_annotated: bool
    is_attached: Optional[bool] = None
    status: Optional[str] = None  # checked, unchecked
    label: Optional[str] = None  # FRONT_MATTER, TOC, TEXT, BACK_MATTER
    is_supplied_title: Optional[bool] = None  # Title supplied by annotator (not from source)
    # Set in enrich_segment_list_rejection_fields
    rejection: Optional[SegmentRejectionSummary] = None
    reviewed_by: Optional[SegmentAttributionUser] = None
    reviewed_at: Optional[datetime] = None
    annotator: Optional[SegmentAttributionUser] = None
    updated_at: Optional[datetime] = None
    created_by_id: Optional[str] = None  # See SegmentResponse
    corrected_by_reviewer: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)

    @model_serializer(mode="wrap")
    def _serialize_omit_nulls(self, serializer):
        data = serializer(self)
        if not isinstance(data, dict):
            return data
        return {k: v for k, v in data.items() if v is not None}


class DocumentResponse(BaseModel):
    id: str
    content: str = ""
    filename: Optional[str] = None
    user_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    status: Optional[str] = None  # active, completed, deleted, approved, rejected
    is_supplied_title: Optional[bool] = None
    submit_count: Optional[int] = None  # admin review submits (POST .../approve)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    segments: List[SegmentResponseDocument] = []

    model_config = ConfigDict(from_attributes=True)


class DocumentWorkspaceResponse(BaseModel):
    """Annotator workspace: id, filename, status, full text, segments only (smaller than DocumentResponse)."""

    id: str
    content: str = ""
    filename: Optional[str] = None
    status: Optional[str] = None
    segments: List[SegmentResponseDocument] = []

    model_config = ConfigDict(from_attributes=True)


class AiOutlineResponse(BaseModel):
    segment_count: int


class AiTocEntryItem(BaseModel):
    page_no: int
    title: str


class AiTocEntriesResponse(BaseModel):
    entries: List[AiTocEntryItem] = []


class RejectedSegmentReviewerUser(BaseModel):
    name: Optional[str] = None
    picture: Optional[str] = None


class RejectedSegmentListNotice(BaseModel):
    """Latest unresolved rejection on a segment still in ``rejected`` status (when included on lists)."""

    message: str = ""
    document_id: str
    segment_id: str
    reviewer_user: Optional[RejectedSegmentReviewerUser] = None


class MyReviewedSegmentsDocumentGroup(BaseModel):
    document_id: str
    filename: str
    approved_count: int = Field(
        description="Segments with status approved where this user is ``reviewed_by_id``.",
    )


class MyReviewedSegmentsResponse(BaseModel):
    groups: List[MyReviewedSegmentsDocumentGroup] = Field(default_factory=list)
    total_approved_segments: int = 0
    total_groups: int = 0
    page: int = 1
    page_size: int = 30
    has_next: bool = False


class AnnotatedPendingReviewDocumentRow(BaseModel):
    document_id: str
    filename: str
    annotator_user_id: Optional[str] = None
    annotator_name: str
    segment_count: int = Field(
        description="Segments on this document with title/author set and status 'checked'.",
    )
    updated_at: datetime


class AnnotatedPendingReviewDocumentsResponse(BaseModel):
    rows: List[AnnotatedPendingReviewDocumentRow] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 30
    has_next: bool = False


class DocumentListResponse(BaseModel):
    id: str
    filename: Optional[str] = None
    user_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    reviewer_user: Optional[RejectedSegmentReviewerUser] = Field(
        None,
        description="Assigned document reviewer (name/picture) when reviewer_id is set.",
    )
    total_segments: int
    annotated_segments: int
    rejection_count: int = 0  # Segments with status rejected in this document
    rejection_comment_count: int = Field(
        0,
        description="Total rejection events (rows in segment_rejections) on this document.",
    )
    rejection_open_segment_count: int = Field(
        0,
        description=(
            "Distinct segments with at least one rejection row whose status is not "
            "checked or approved (rejection path not finished)."
        ),
    )
    reviewer_changed_segments: int = Field(
        0,
        description="Segments the reviewer split/merged or added during review.",
    )
    progress_percentage: float
    checked_segments: int  # Segments with status checked or approved
    unchecked_segments: int  # Segments not yet checked or approved
    status: Optional[str] = None  # active, completed, deleted, approved, rejected
    created_at: datetime
    updated_at: datetime
    rejected_segment: Optional[RejectedSegmentListNotice] = None
    rejection_resolved: bool = Field(
        default=False,
        description=(
            "True when a reviewer rejected a segment, the annotator moved it to checked, "
            "and the latest rejection row is resolved."
        ),
    )

    class Config:
        from_attributes = True


class RandomReviewedDocumentSummary(BaseModel):
    """One random approved document with id and optional stored filename."""

    id: str = Field(..., description="Document primary key")
    filename: Optional[str] = Field(None, description="Stored filename when present")


class RandomReviewedDocumentIdsResponse(BaseModel):
    """Up to five random documents whose workflow status is approved (reviewed)."""

    documents: List[RandomReviewedDocumentSummary] = Field(
        ...,
        description="Id and filename for each document; may be fewer than five if not enough approved documents exist.",
    )


class BulkSegmentUpdate(BaseModel):
    segments: List[SegmentUpdate] = Field(..., description="List of segment updates with segment IDs")
    segment_ids: List[str] = Field(..., description="Corresponding segment IDs for each update")


class SplitSegmentRequest(BaseModel):
    segment_id: str
    split_position: int  # Character offset within segment text
    document_id: Optional[str] = None  # Optional: used when segment doesn't exist yet


class MergeSegmentsRequest(BaseModel):
    segment_ids: List[str] = Field(..., min_items=2, description="IDs of segments to merge (in order)")


class BulkSegmentOperationsRequest(BaseModel):
    """Request model for bulk segment operations"""

    create: Optional[List[SegmentCreate]] = Field(None, description="Segments to create")
    update: Optional[List[dict]] = Field(None, description="List of dicts with 'id' and update fields")
    delete: Optional[List[str]] = Field(None, description="Segment IDs to delete")


class DocumentStatusUpdate(BaseModel):
    status: str


class DocumentAssigneeUpdate(BaseModel):
    user_id: str = Field(..., min_length=1)


class SegmentStatusUpdate(BaseModel):
    status: str


class AnnotatorPerformanceRow(BaseModel):
    user_id: Optional[str] = None
    document_count: int
    segment_count: int
    segments_with_title_or_author: int
    rejection_count: int = Field(
        ...,
        description="Segments still rejected with latest rejection unresolved (annotator has not addressed)",
    )
    rejection_event_count: int = Field(
        0,
        description=(
            "Total rows in segment_rejections for this annotator's documents "
            "(user_id on rejection or document owner), scoped by document.created_at."
        ),
    )
    rejection_events_pct_of_segments: Optional[float] = Field(
        None,
        description="100 * rejection_event_count / segment_count when segment_count > 0.",
    )
    segments_reviewed: int = Field(
        0,
        description="Segments currently checked/approved where this user is recorded as reviewer",
    )
    segments_self_reviewed: int = Field(
        0,
        description="Subset of segments_reviewed on documents owned by the same user (annotator checked own work)",
    )
    reviewer_rejection_count: int = Field(
        0,
        description="Rejection events logged with this user as reviewer",
    )
    segments_reviewer_corrected_title_or_author: int = Field(
        0,
        description=(
            "Approved segments on this user's documents where reviewer set title or author at approval"
        ),
    )
    segments_approved: int = Field(
        0,
        description=(
            "Segments with status approved on this user's documents (same document date scope as segment_count)"
        ),
    )


class VolumeBatchStatusCounts(BaseModel):
    """Counts for one volume batch from BEC OT API ``/stats/volume-batches``."""

    in_review: int
    reviewed: int
    in_progress: int
    active: int
    skipped: int = 0


class ReviewerSegmentActivityRow(BaseModel):
    user_id: str
    segments_recorded_as_reviewer: int = Field(
        ...,
        description=(
            "Checked or approved segments in scope where this user is ``reviewed_by_id`` "
            "(who recorded the review transition)."
        ),
    )
    reviewed_segments_with_title_or_author: int = Field(
        0,
        description=(
            "Checked or approved segments in scope with matching ``reviewed_by_id`` where "
            "annotator ``title`` and/or ``author`` is non-empty (same date window as other columns)."
        ),
    )
    reviewer_title_author_edits: int = Field(
        0,
        description=(
            "Approved segments in scope with matching ``reviewed_by_id`` where trimmed "
            "``reviewer_title`` differs from ``title`` and/or trimmed ``reviewer_author`` "
            "differs from ``author`` (non-empty reviewer field required for that side)."
        ),
    )
    reviewer_rejection_count: int = Field(
        0,
        description=(
            "Count of ``segment_rejections`` rows in scope with this user as ``reviewer_id`` "
            "(same document date filter as other dashboard aggregates)."
        ),
    )


class DashboardChartSeries(BaseModel):
    labels: List[str]
    values: List[int]
    keys: List[str] = Field(default_factory=list)


class DashboardOverviewBar(BaseModel):
    labels: List[str]
    values: List[int]


class DashboardLabeledCount(BaseModel):
    key: str
    label: str
    count: int


class DashboardDocumentStatusBreakdown(BaseModel):
    approved: int = 0
    completed: int = 0
    active: int = 0
    skipped: int = 0


class AnnotatorQualityTableRow(BaseModel):
    user_id: Optional[str] = None
    name: str
    segments: int
    segments_approved: int
    rejection_events: int
    rejection_pct: float
    correction_edits: int
    corrections_pct: float


class AnnotatorQualityChartMeta(BaseModel):
    events: int = 0
    approved: int = 0
    edits: int = 0


class AnnotatorQualityChart(BaseModel):
    labels: List[str]
    rejection_pct: List[float]
    rejection_meta: List[AnnotatorQualityChartMeta]
    edits_pct: List[float]
    edits_meta: List[AnnotatorQualityChartMeta]
    segment_counts: List[int]
    approved_counts: List[int]


class AnnotatorQualityView(BaseModel):
    chart: AnnotatorQualityChart
    table_rows: List[AnnotatorQualityTableRow]


class AnnotatorWorkloadSeries(BaseModel):
    label: str
    values: List[int]


class AnnotatorWorkloadView(BaseModel):
    labels: List[str]
    series: List[AnnotatorWorkloadSeries]


class ReviewerActivityTableRow(BaseModel):
    user_id: Optional[str] = None
    name: str
    segments_reviewed: int
    with_title_author: int
    title_author_edits: int
    rejections: int
    reviewed_share_pct: float
    with_title_author_rate_pct: float
    edits_rate_pct: float
    rejections_rate_pct: float
    reviewed_bar_pct: float
    with_title_author_bar_pct: float
    edits_bar_pct: float
    rejections_bar_pct: float


class ReviewerActivityChart(BaseModel):
    labels: List[str]
    segments_reviewed: List[int]
    with_title_author: List[int]
    title_author_edits: List[int]
    rejections: List[int]


class ReviewerActivityView(BaseModel):
    has_activity: bool
    chart: Optional[ReviewerActivityChart] = None
    table_rows: List[ReviewerActivityTableRow] = Field(default_factory=list)


class VolumeBatchTableRow(BaseModel):
    batch_id: str
    in_review: int
    reviewed: int
    in_progress: int
    active: int
    skipped: int = 0


class VolumeBatchView(BaseModel):
    state: str = Field(
        ...,
        description="One of: unavailable, empty, rows",
    )
    rows: List[VolumeBatchTableRow] = Field(default_factory=list)
    total_active: int = 0
    show_low_batch_warning: bool = False


class DashboardPresentation(BaseModel):
    """Precomputed labels, charts, and table rows for the admin overview UI."""

    overview_bar: DashboardOverviewBar
    document_status_chart: Optional[DashboardChartSeries] = None
    segment_status_chart: Optional[DashboardChartSeries] = None
    segment_status_footer: List[DashboardLabeledCount]
    segment_label_chart: Optional[DashboardChartSeries] = None
    document_status_breakdown: DashboardDocumentStatusBreakdown
    annotator_quality: Optional[AnnotatorQualityView] = None
    annotator_workload: Optional[AnnotatorWorkloadView] = None
    reviewer_activity: ReviewerActivityView
    volume_batches: VolumeBatchView


class DashboardStatsResponse(BaseModel):
    document_count: int
    total_segments: int
    segments_with_title_or_author: int
    reviewed_segments: int = Field(
        ...,
        description="Among segments with non-empty title or author: status approved",
    )
    annotated_segments: int = Field(
        ...,
        description="Among segments with non-empty title or author: status checked (annotated, awaiting review)",
    )
    rejected_segments_with_title_or_author: int = Field(
        ...,
        description="Among segments with non-empty title or author: status rejected",
    )
    unchecked_segments_with_title_or_author: int = Field(
        ...,
        description="Among segments with non-empty title or author: status unchecked or null",
    )
    annotating_segments: int = Field(
        ...,
        description="All segments with status unchecked or null (not limited to title/author)",
    )
    rejection_count: int = Field(
        ...,
        description="Same as annotator chart: rejected segments whose latest rejection row is not resolved",
    )

   
    document_status_counts: Dict[str, int]
    document_category_counts: Dict[str, int]
    segment_status_counts: Dict[str, int]
    segment_label_counts: Dict[str, int]
    segments_with_bdrc_id: int
    segments_with_parent: int
    segments_with_comments: int = Field(
        ...,
        description="Rejected segments that have comment data stored",
    )
    segments_reviewer_corrected_title_or_author: int = Field(
        ...,
        description="Approved segments where reviewer changed title or author vs snapshot at check time",
    )
   
    annotation_coverage_pct: float
    annotator_performance: List[AnnotatorPerformanceRow]
    reviewer_segment_activity: List[ReviewerSegmentActivityRow] = Field(
        default_factory=list,
        description=(
            "All users with role reviewer or admin: segment counts in the same document scope "
            "and date range as the rest of this response (respects annotator user_id filter)."
        ),
    )
    volume_batch_stats: Optional[Dict[str, VolumeBatchStatusCounts]] = Field(
        default=None,
        description=(
            "Per batch ID from BEC OT API ``/api/v1/stats/volume-batches``. "
            "Not scoped by dashboard date or annotator filters. Null if the upstream request failed."
        ),
    )
    presentation: DashboardPresentation = Field(
        ...,
        description="Precomputed chart series, table rows, and display labels for the admin overview.",
    )


class ReviewVerifierBreakdownRow(BaseModel):
    user_id: str
    reviewer: str
    total_segments: int = 0
    approvals: int = 0
    rejections: int = 0


class ReviewerStatsBreakdownRow(BaseModel):
    user_id: str
    reviewer: str
    approvals: int = 0
    rejections: int = 0


class ReviewerStatsResponse(BaseModel):
    review_verifier_breakdown: List[ReviewVerifierBreakdownRow] = Field(default_factory=list)
    reviewer_breakdown: List[ReviewerStatsBreakdownRow] = Field(default_factory=list)


class AnnotatorWeeklyQualityRow(BaseModel):
    """One annotator's volume and quality rates inside a single ISO week."""

    user_id: Optional[str] = None
    name: str
    week: Optional[str] = None
    approved: int = 0
    edited: int = 0
    rejected: int = 0
    clean: int = 0
    edits_pct: float = 0.0
    rejection_pct: float = 0.0
    clean_pct: float = 0.0


class AnnotatorWeeklyQualityResponse(BaseModel):
    bucket_by: str
    rows: List[AnnotatorWeeklyQualityRow] = Field(default_factory=list)


class AnnotatorApprovedRow(BaseModel):
    user_id: Optional[str] = None
    name: str
    segments_approved: int
    edited_segments: int = 0
    rejection_count: int = 0
    rejected_segments: int = 0


class ReviewerApprovedRow(BaseModel):
    user_id: Optional[str] = None
    name: str
    segments_reviewed: int
    edited_segments: int = 0
    rejection_count: int = 0
    # Approved segments the reviewer added themselves during review (not in segments_reviewed).
    segments_annotated: int = 0


class StatisticsResponse(BaseModel):
    annotators: List[AnnotatorApprovedRow] = Field(default_factory=list)
    reviewers: List[ReviewerApprovedRow] = Field(default_factory=list)
    # the filtered user's own review output; empty without a user filter
    reviewed_by_user: List[ReviewerApprovedRow] = Field(default_factory=list)


class GroupMemberOut(BaseModel):
    user_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    picture: Optional[str] = None
    role: Optional[str] = None


class GroupOut(BaseModel):
    """A work group: its members get new volumes from ``batch_id`` and review each
    other's completed documents."""

    id: str
    name: str
    batch_id: Optional[str] = None
    members: List[GroupMemberOut] = Field(default_factory=list)


class MyGroupOut(BaseModel):
    id: str
    name: str
    batch_id: Optional[str] = None


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1)
    batch_id: Optional[str] = None


class GroupUpdate(BaseModel):
    """Fields left out are unchanged. Send ``batch_id: null`` to unlink the batch."""

    name: Optional[str] = Field(None, min_length=1)
    batch_id: Optional[str] = None


class GroupMembersUpdate(BaseModel):
    """The group's full member list; replaces the current one."""

    user_ids: List[str] = Field(default_factory=list)


class BatchOption(BaseModel):
    batch_id: str
    active: int = Field(0, description="Volumes still waiting to be assigned")


class AssignVolumeRequest(BaseModel):
    group_id: Optional[str] = Field(
        None,
        description="Group to take work from; needed only when the user is in more than one group.",
    )
