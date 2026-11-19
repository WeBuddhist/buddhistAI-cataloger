"""Routes under ``/outliner/segments`` (top-level segment resource)."""

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from outliner.controller.outliner import (
    add_segment_comment as add_segment_comment_ctrl,
    delete_segment as delete_segment_ctrl,
    delete_segment_comment as delete_segment_comment_ctrl,
    get_segment as get_segment_ctrl,
    get_segment_comments as get_segment_comments_ctrl,
    list_segment_rejections as list_segment_rejections_ctrl,
    merge_segments as merge_segments_ctrl,
    reject_segment as reject_segment_ctrl,
    reject_segments_bulk as reject_segments_bulk_ctrl,
    split_segment as split_segment_ctrl,
    update_segment as update_segment_ctrl,
    update_segment_comment as update_segment_comment_ctrl,
    update_segment_status as update_segment_status_ctrl,
    update_segments_bulk as update_segments_bulk_ctrl,
)
from outliner.controller.segment_review import (
    submit_segment_review as submit_segment_review_ctrl,
)
from outliner.deps import (
    apply_authenticated_segment_reviewer,
    assert_assigned_document_participant,
    assert_assigned_document_reviewer,
    assert_document_editable,
    can_user_reject_segment,
    enforce_segment_review_patch_authorization,
    is_user_admin_or_reviewer,
    require_outliner_access,
)
from outliner.controller.review_split_limit import assert_reviewer_can_split
from outliner.repository.document import fetch_document_by_id
from outliner.repository.segment import (
    document_has_rejected_segment,
    get_document_id_for_segment,
    get_document_review_context_for_segment,
    get_document_lock_context_for_segment,
    get_document_user_id_for_segment,
    map_segment_ids_to_document_user_ids,
)
from user.models.user import User

from .helpers import build_segment_response, document_plain_content
from .schemas import (
    BulkRejectRequest,
    BulkSegmentUpdate,
    CommentAdd,
    CommentResponse,
    CommentUpdate,
    MergeSegmentsRequest,
    RejectSegmentRequest,
    SegmentRejectionHistoryItem,
    SegmentRejectionHistoryResponse,
    SegmentResponse,
    SegmentReviewRequest,
    SegmentReviewResponse,
    SegmentStatusUpdate,
    SegmentUpdate,
    SplitSegmentRequest,
)

router = APIRouter()


def _assert_segment_document_editable(
    db: Session, segment_id: str, document_reviewer_id: str | None, user: User
) -> None:
    """Refuse changes to an approved document's segments (see ``assert_document_editable``)."""
    status, has_rejected = get_document_lock_context_for_segment(db, segment_id)
    assert_document_editable(
        status, document_reviewer_id, user, has_rejected_segment=has_rejected
    )


@router.get("/segments/{segment_id}", response_model=SegmentResponse)
def get_segment(
    segment_id: str,
    db: Session = Depends(get_db),
):
    """Get a single segment by ID"""
    segment = get_segment_ctrl(db, segment_id)
    return build_segment_response(
        segment,
        db,
        document_content=document_plain_content(db, segment.document_id),
    )


@router.get(
    "/segments/{segment_id}/rejections",
    response_model=SegmentRejectionHistoryResponse,
)
def list_segment_rejections(
    segment_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_outliner_access),
):
    """All rejection events for a segment (newest first)."""
    rows = list_segment_rejections_ctrl(db, segment_id)
    return SegmentRejectionHistoryResponse(
        items=[SegmentRejectionHistoryItem.model_validate(r) for r in rows]
    )


@router.put("/segments/{segment_id}", status_code=201)
def update_segment(
    segment_id: str,
    segment_update: SegmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """
    PERFORMANCE OPTIMIZED: Update a segment's content or annotations.

    Optimizations:
    1. Single SELECT to get segment (with old annotation status)
    2. Incremental document progress update (no COUNT queries)
    3. Avoid db.refresh() by using already-updated ORM object
    4. Single transaction commit

    Performance: Reduced from ~5 queries to 1-2 queries:
    - Before: 1 SELECT (segment) + 1 SELECT (document) + 2 COUNT(*) + 1 UPDATE (doc) + 1 UPDATE (segment) + 1 SELECT (refresh)
    - After: 1 SELECT (segment) + 1 UPDATE (segment) + 1 UPDATE (doc, if annotation changed)
    """
    patch = segment_update.model_dump(exclude_unset=True)
    doc_owner, doc_reviewer = get_document_review_context_for_segment(db, segment_id)
    _assert_segment_document_editable(db, segment_id, doc_reviewer, current_user)
    enforce_segment_review_patch_authorization(
        patch,
        current_user,
        document_owner_id=doc_owner,
        document_reviewer_id=doc_reviewer,
    )
    apply_authenticated_segment_reviewer(
        patch, current_user, document_owner_id=doc_owner
    )
    segment = update_segment_ctrl(db, segment_id, patch)
    return {"message": "segment updated", "id": segment.id}


@router.put("/segments/bulk", response_model=List[SegmentResponse])
def update_segments_bulk(
    updates: BulkSegmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Update multiple segments at once"""
    segment_updates = [seg.model_dump(exclude_unset=True) for seg in updates.segments]
    owner_by_segment = map_segment_ids_to_document_user_ids(db, list(updates.segment_ids))
    for row, seg_id in zip(segment_updates, updates.segment_ids, strict=True):
        doc_owner = owner_by_segment.get(seg_id)
        _, doc_reviewer = get_document_review_context_for_segment(db, seg_id)
        _assert_segment_document_editable(db, seg_id, doc_reviewer, current_user)
        enforce_segment_review_patch_authorization(
            row,
            current_user,
            document_owner_id=doc_owner,
            document_reviewer_id=doc_reviewer,
        )
        apply_authenticated_segment_reviewer(
            row, current_user, document_owner_id=doc_owner
        )
    updated_segments = update_segments_bulk_ctrl(db, segment_updates, updates.segment_ids)
    content = (
        document_plain_content(db, updated_segments[0].document_id)
        if updated_segments
        else ""
    )

    segment_responses = []
    for segment in updated_segments:
        segment_responses.append(build_segment_response(segment, db, document_content=content))
    return segment_responses


def _assert_can_restructure_segments(
    db: Session,
    segment_id: str,
    user: User,
    document_id: str | None = None,
) -> str | None:
    """Split/merge/delete change the outline itself: only the document's assigned annotator
    or reviewer may do it. ``document_id`` covers the first split, when no segment exists yet.

    Returns the caller's id when they act as the document's reviewer (so their segments are
    credited to them), else None.
    """
    doc_owner, doc_reviewer = get_document_review_context_for_segment(db, segment_id)
    doc_status, has_rejected = get_document_lock_context_for_segment(db, segment_id)
    if doc_owner is None and doc_reviewer is None and document_id:
        doc = fetch_document_by_id(db, document_id)
        if doc:
            doc_owner, doc_reviewer, doc_status = doc.user_id, doc.reviewer_id, doc.status
            has_rejected = doc_status == "approved" and document_has_rejected_segment(
                db, document_id
            )
    assert_assigned_document_participant(doc_owner, doc_reviewer, user)
    assert_document_editable(doc_status, doc_reviewer, user, has_rejected_segment=has_rejected)
    if doc_reviewer == user.id and doc_owner != user.id:
        return user.id
    return None


@router.post("/segments/{segment_id}/split")
def split_segment(
    segment_id: str,
    split_request: SplitSegmentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Split a segment at a given position"""
    reviewer_id = _assert_can_restructure_segments(
        db, split_request.segment_id, current_user, split_request.document_id
    )
    if reviewer_id:
        document_id = (
            get_document_id_for_segment(db, split_request.segment_id)
            or split_request.document_id
        )
        if document_id:
            assert_reviewer_can_split(db, document_id, current_user)
    split_segment_ctrl(
        db=db,
        segment_id=split_request.segment_id,
        split_position=split_request.split_position,
        document_id=split_request.document_id,
        reviewer_id=reviewer_id,
    )

    return {"message": "segment split", "id": segment_id}


@router.post("/segments/merge", response_model=SegmentResponse)
def merge_segments(
    merge_request: MergeSegmentsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Merge multiple segments into one"""
    # The controller rejects segments from different documents before changing anything,
    # so checking the first one's document is enough.
    reviewer_id = _assert_can_restructure_segments(
        db, merge_request.segment_ids[0], current_user
    )
    first_segment = merge_segments_ctrl(
        db, merge_request.segment_ids, reviewer_id=reviewer_id
    )
    return build_segment_response(
        first_segment,
        db,
        document_content=document_plain_content(db, first_segment.document_id),
    )


@router.delete("/segments/{segment_id}", status_code=204)
def delete_segment(
    segment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Delete a segment"""
    _assert_can_restructure_segments(db, segment_id, current_user)
    delete_segment_ctrl(db, segment_id)
    return None


@router.get("/segments/{segment_id}/comment", response_model=List[CommentResponse])
def get_segment_comments(
    segment_id: str,
    db: Session = Depends(get_db),
):
    """Get all comments for a segment"""
    comments_list = get_segment_comments_ctrl(db, segment_id)
    return [CommentResponse(**c) for c in comments_list]


@router.post("/segments/{segment_id}/comment", response_model=List[CommentResponse])
def add_segment_comment(
    segment_id: str,
    comment: CommentAdd,
    db: Session = Depends(get_db),
):
    """Add a comment to a segment"""
    comments_list = add_segment_comment_ctrl(
        db=db,
        segment_id=segment_id,
        content=comment.content,
        username=comment.username,
    )
    return [CommentResponse(**c) for c in comments_list]


@router.put("/segments/{segment_id}/comment/{comment_index}", response_model=List[CommentResponse])
def update_segment_comment(
    segment_id: str,
    comment_index: int,
    comment_update: CommentUpdate,
    db: Session = Depends(get_db),
):
    """Update a specific comment by index"""
    comments_list = update_segment_comment_ctrl(
        db=db,
        segment_id=segment_id,
        comment_index=comment_index,
        content=comment_update.content,
    )
    return [CommentResponse(**c) for c in comments_list]


@router.delete("/segments/{segment_id}/comment/{comment_index}", response_model=List[CommentResponse])
def delete_segment_comment(
    segment_id: str,
    comment_index: int,
    db: Session = Depends(get_db),
):
    """Delete a specific comment by index"""
    comments_list = delete_segment_comment_ctrl(
        db=db,
        segment_id=segment_id,
        comment_index=comment_index,
    )
    return [CommentResponse(**c) for c in comments_list]


@router.put("/segments/{segment_id}/status")
def update_segment_status(
    segment_id: str,
    status_update: SegmentStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Update segment status (checked/unchecked)"""
    st = (status_update.status or "").strip().lower()
    doc_owner, doc_reviewer = get_document_review_context_for_segment(db, segment_id)
    _assert_segment_document_editable(db, segment_id, doc_reviewer, current_user)
    self_owned = doc_owner is not None and doc_owner == current_user.id
    if not self_owned:
        assert_assigned_document_participant(
            doc_owner, doc_reviewer, current_user
        )
    reviewer_id = (
        current_user.id
        if is_user_admin_or_reviewer(current_user)
        and st in ("checked", "approved")
        and not self_owned
        else None
    )
    return update_segment_status_ctrl(
        db=db,
        segment_id=segment_id,
        status=status_update.status,
        reviewer_id=reviewer_id,
    )


@router.put("/segments/{segment_id}/reject", response_model=SegmentResponse)
def reject_segment(
    segment_id: str,
    body: RejectSegmentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Reject a checked segment"""
    doc_owner, doc_reviewer = get_document_review_context_for_segment(db, segment_id)
    assert_assigned_document_reviewer(doc_reviewer, current_user)
    can_user_reject_segment(current_user, [doc_owner])
    segment = reject_segment_ctrl(
        db,
        segment_id,
        current_user.id,
        body.comment,
        [span.model_dump() for span in body.marked_spans] if body.marked_spans else None,
    )
    return build_segment_response(
        segment,
        db,
        document_content=document_plain_content(db, segment.document_id),
    )


@router.post(
    "/segments/{segment_id}/review",
    response_model=SegmentReviewResponse,
    status_code=201,
)
def submit_segment_review(
    segment_id: str,
    body: SegmentReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Record the current user's approve/reject decision on a segment (view-only review)."""
    return submit_segment_review_ctrl(
        db, segment_id, current_user.id, body.status, body.comment
    )


@router.put("/segments/bulk-reject", response_model=List[SegmentResponse])
def reject_segments_bulk(
    request: BulkRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Reject multiple checked segments at once"""
    owner_by_segment = map_segment_ids_to_document_user_ids(db, list(request.segment_ids))
    for seg_id in request.segment_ids:
        _, doc_reviewer = get_document_review_context_for_segment(db, seg_id)
        assert_assigned_document_reviewer(doc_reviewer, current_user)
    can_user_reject_segment(current_user, list(owner_by_segment.values()))
    segments = reject_segments_bulk_ctrl(
        db, request.segment_ids, current_user.id, request.comment
    )
    return [
        build_segment_response(
            seg,
            db,
            document_content=document_plain_content(db, seg.document_id),
        )
        for seg in segments
    ]
