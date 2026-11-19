"""Routes under ``/outliner/documents`` (including nested ``.../segments``)."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
from outliner.controller.segment_review import (
    get_segment_review_statuses as get_segment_review_statuses_ctrl,
)
from outliner.controller.review_split_limit import reviewer_split_usage
from outliner.repository.document import fetch_document_by_id, fetch_document_reviewer_id
from outliner.repository.segment import document_has_rejected_segment
from outliner.controller.bdrc import check_document_sanity as check_document_sanity_ctrl
from outliner.controller.outliner import (
    approve_document as approve_document_ctrl,
    assign_document_reviewer as assign_document_reviewer_ctrl,
    assign_reviewr as assign_reviewr_ctrl,
    bulk_segment_operations as bulk_segment_operations_ctrl,
    create_document as create_document_ctrl,
    create_segment as create_segment_ctrl,
    create_segments_bulk as create_segments_bulk_ctrl,
    delete_document as delete_document_ctrl,
    get_document as get_document_ctrl,
    get_document_ai_toc_entries as get_document_ai_toc_entries_ctrl,
    get_document_for_workspace as get_document_for_workspace_ctrl,
    get_document_progress as get_document_progress_ctrl,
    list_documents as list_documents_ctrl,
    list_my_reviewed_segments_grouped as list_my_reviewed_segments_grouped_ctrl,
    list_segments as list_segments_ctrl,
    random_reviewed_document_ids as random_reviewed_document_ids_ctrl,
    reset_segments as reset_segments_ctrl,
    submit_document_to_bdrc_in_review as submit_document_to_bdrc_in_review_ctrl,
    update_document_assignee as update_document_assignee_ctrl,
    update_document_content as update_document_content_ctrl,
    update_document_status as update_document_status_ctrl,
    ai_toc_db_value_to_api_items,
)
from outliner.deps import (
    apply_authenticated_segment_reviewer_bulk,
    assert_assigned_document_annotator,
    assert_assigned_document_participant,
    assert_assigned_document_reviewer,
    assert_document_editable,
    enforce_segment_review_patch_authorization,
    is_user_admin_or_reviewer,
    require_outliner_access,
)
from user.models.user import User

from .helpers import (
    build_document_response,
    build_segment_response,
    document_plain_content,
    segment_list_row_to_document_segment,
)
from .schemas import (
    AiTocEntriesResponse,
    AiTocEntryItem,
    BulkSegmentOperationsRequest,
    DocumentCreate,
    DocumentListResponse,
    MyReviewedSegmentsResponse,
    DocumentResponse,
    DocumentAssigneeUpdate,
    RandomReviewedDocumentIdsResponse,
    DocumentStatusUpdate,
    DocumentWorkspaceResponse,
    SanityCheckRequest,
    SegmentCreate,
    SegmentResponse,
    SegmentReviewsResponse,
    SegmentReviewStatusItem,
    SubmitToBdrcRequest,
)

router = APIRouter()


@router.post("/documents", response_model=DocumentResponse, status_code=201)
def create_document(
    document: DocumentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Create a new outliner document with full text content"""
    db_document = create_document_ctrl(
        db=db,
        content=document.content,
        filename=document.filename,
        user_id=current_user.id,
    )
    return db_document


@router.get("/documents", response_model=List[DocumentListResponse])
def list_documents(
    user_id: Optional[str] = None,
    reviewer_id: Optional[str] = None,
    status: Optional[str] = None,
    title: Optional[str] = Query(
        None,
        description="Case-insensitive partial match on document title (filename)",
    ),
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
    include_approved: bool = False,
    include_skipped: bool = False,
    hide_test_rejected: bool = Query(
        False,
        description="TEMP: hide Tsenlek (mmBERT test) documents that are fully reviewed and have a rejected segment",
    ),
    group_id: Optional[str] = Query(None, description="Only documents assigned from this group"),
    db: Session = Depends(get_db),
):

    result = list_documents_ctrl(
        db=db,
        user_id=user_id,
        reviewer_id=reviewer_id,
        status=status,
        skip=skip,
        limit=limit,
        include_deleted=include_deleted,
        include_approved=include_approved,
        include_skipped=include_skipped,
        title=title,
        hide_test_rejected=hide_test_rejected,
        group_id=group_id,
    )
    return result


@router.get(
    "/documents/random-reviewed-ids",
    response_model=RandomReviewedDocumentIdsResponse,
)
def random_reviewed_document_ids(db: Session = Depends(get_db)):
    """Return up to five random approved documents, each with id and filename."""
    return random_reviewed_document_ids_ctrl(db, limit=5)


@router.get(
    "/documents/my-reviewed-segments",
    response_model=MyReviewedSegmentsResponse,
)
def my_reviewed_segments(
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Approved segments where the current user is ``reviewed_by_id``, grouped by document."""
    return list_my_reviewed_segments_grouped_ctrl(
        db, current_user.id, page=page, page_size=page_size
    )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: str,
    include_segments: bool = True,
    db: Session = Depends(get_db),
):
    """Get a document by ID with all its segments (full metadata)."""
    document = get_document_ctrl(db, document_id, include_segments)
    # If segments are requested but none exist, create a single segment covering the entire document
    if include_segments:
        segments_exist = (
            hasattr(document, "segment_list")
            and document.segment_list
            and len(document.segment_list) > 0
        )
        if not segments_exist:
            text_length = len(document.content)
            create_segment_ctrl(
                db=db,
                document_id=document_id,
                segment_index=0,
                span_start=0,
                span_end=text_length,
                text=None,
            )
            document = get_document_ctrl(db, document_id, include_segments)

    reviewer_id = fetch_document_reviewer_id(db, document_id)
    if include_segments and hasattr(document, "segment_list") and document.segment_list:
        segments_resp = [
            segment_list_row_to_document_segment(s) for s in document.segment_list
        ]
        response = build_document_response(
            document, segments_resp, reviewer_id=reviewer_id
        )
    else:
        response = build_document_response(document, [], reviewer_id=reviewer_id)
    # The review page shows how many segments the reviewer may still split off.
    used, limit = reviewer_split_usage(db, document_id)
    response.reviewer_splits_used = used
    response.reviewer_split_limit = limit
    return response


@router.get(
    "/documents/{document_id}/workspace",
    response_model=DocumentWorkspaceResponse,
    
)
def get_document_workspace(
    document_id: str,
    include_segments: bool = True,
    db: Session = Depends(get_db),
):
    """
    Annotator workspace: id, filename, status, full text, and segments only.
    Content is served from Redis when cached; otherwise one read of the content column.
    Segments are read only from outliner_segments for this document.
    """
    document = get_document_for_workspace_ctrl(db, document_id, include_segments)

    if include_segments:
        segments_exist = (
            hasattr(document, "segment_list")
            and document.segment_list
            and len(document.segment_list) > 0
        )
        if not segments_exist:
            text_length = len(document.content)
            create_segment_ctrl(
                db=db,
                document_id=document_id,
                segment_index=0,
                span_start=0,
                span_end=text_length,
                text=None,
            )
            document = get_document_for_workspace_ctrl(db, document_id, include_segments)

    if include_segments and hasattr(document, "segment_list") and document.segment_list:
        segments_resp = [
            segment_list_row_to_document_segment(s) for s in document.segment_list
        ]
        return DocumentWorkspaceResponse(
            id=document.id,
            content=document.content,
            filename=document.filename,
            status=getattr(document, "status", None),
            segments=segments_resp,
        )
    return DocumentWorkspaceResponse(
        id=document.id,
        content=document.content,
        filename=document.filename,
        status=getattr(document, "status", None),
        segments=[],
    )


@router.get(
    "/documents/{document_id}/ai-toc-entries",
    response_model=AiTocEntriesResponse,
)
def get_document_ai_toc_entries(
    document_id: str,
    db: Session = Depends(get_db),
):
    """Return AI / stored TOC as page numbers and titles (not included on the main document payload)."""
    raw = get_document_ai_toc_entries_ctrl(db, document_id)
    items = ai_toc_db_value_to_api_items(raw)
    return AiTocEntriesResponse(entries=[AiTocEntryItem(**row) for row in items])


@router.put("/documents/{document_id}/content")
def update_document_content(
    document_id: str,
    content: str,
    db: Session = Depends(get_db),
):
    """Update the full text content of a document"""
    return update_document_content_ctrl(db, document_id, content)


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
):
    """Delete a document and all its segments"""
    delete_document_ctrl(db, document_id)
    return None


def _assert_doc_editable(db: Session, doc, user: User) -> None:
    """Refuse changes to an approved document (see ``assert_document_editable``)."""
    assert_document_editable(
        doc.status,
        doc.reviewer_id,
        user,
        has_rejected_segment=doc.status == "approved"
        and document_has_rejected_segment(db, doc.id),
    )


def _assert_document_participant(db: Session, document_id: str, user: User) -> None:
    """Segment-creating routes are limited to the document's assigned annotator or reviewer."""
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    assert_assigned_document_participant(doc.user_id, doc.reviewer_id, user)
    _assert_doc_editable(db, doc, user)


@router.post("/documents/{document_id}/segments", response_model=SegmentResponse, status_code=201)
def create_segment(
    document_id: str,
    segment: SegmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Create a new segment in a document"""
    _assert_document_participant(db, document_id, current_user)
    db_segment = create_segment_ctrl(
        db=db,
        document_id=document_id,
        segment_index=segment.segment_index,
        span_start=segment.span_start,
        span_end=segment.span_end,
        text=segment.text,
        title=segment.title,
        author=segment.author,
        title_bdrc_id=segment.title_bdrc_id,
        author_bdrc_id=segment.author_bdrc_id,
        parent_segment_id=segment.parent_segment_id,
    )
    return build_segment_response(
        db_segment,
        db,
        document_content=document_plain_content(db, document_id),
    )


@router.post("/documents/{document_id}/segments/bulk", response_model=List[SegmentResponse], status_code=201)
def create_segments_bulk(
    document_id: str,
    segments: List[SegmentCreate],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Create multiple segments at once"""
    _assert_document_participant(db, document_id, current_user)
    segments_data = [seg.dict() for seg in segments]
    db_segments = create_segments_bulk_ctrl(db, document_id, segments_data)
    content = document_plain_content(db, document_id)

    segment_responses = []
    for segment in db_segments:
        segment_responses.append(build_segment_response(segment, db, document_content=content))
    return segment_responses


@router.get("/documents/{document_id}/segments", response_model=List[SegmentResponse])
def list_segments(
    document_id: str,
    db: Session = Depends(get_db),
):
    """Get all segments for a document"""
    content = document_plain_content(db, document_id)
    segments = list_segments_ctrl(db, document_id)
    segment_responses = []
    for segment in segments:
        segment_responses.append(build_segment_response(segment, db, document_content=content))
    return segment_responses


@router.post("/documents/{document_id}/segments/bulk-operations", response_model=List[SegmentResponse])
def bulk_segment_operations(
    document_id: str,
    operations: BulkSegmentOperationsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """
    Perform bulk operations on segments: create, update, and delete in a single transaction.
    This is optimized for performance by batching all operations together.
    """
    create_data = [seg.dict() for seg in operations.create] if operations.create else None
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc_owner = doc.user_id
    doc_reviewer = doc.reviewer_id
    _assert_doc_editable(db, doc, current_user)
    if operations.update:
        for row in operations.update:
            if not isinstance(row, dict):
                continue
            enforce_segment_review_patch_authorization(
                row,
                current_user,
                document_owner_id=doc_owner,
                document_reviewer_id=doc_reviewer,
            )
    apply_authenticated_segment_reviewer_bulk(
        operations.update, current_user, document_owner_id=doc_owner
    )
    result_segments = bulk_segment_operations_ctrl(
        db=db,
        document_id=document_id,
        create=create_data,
        update=operations.update,
        delete=operations.delete,
    )
    content = document_plain_content(db, document_id)

    segment_responses = []
    for seg in result_segments:
        segment_responses.append(build_segment_response(seg, db, document_content=content))
    return segment_responses


@router.delete("/documents/{document_id}/segments/reset", status_code=204)
def reset_segments(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Delete all segments for a document"""
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    assert_assigned_document_participant(
        doc.user_id, doc.reviewer_id, current_user
    )
    _assert_doc_editable(db, doc, current_user)
    reset_segments_ctrl(db, document_id)
    return None


@router.put("/documents/{document_id}/status")
async def update_document_status(
    document_id: str,
    status_update: DocumentStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """
    Update document status.

    When restoring a deleted document (changing status from 'deleted' to 'active'),
    ownership is verified against the authenticated user.
    """
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    st = (status_update.status or "").strip().lower()
    if st == "completed":
        assert_assigned_document_annotator(doc.user_id, current_user)
    elif st == "approved":
        assert_assigned_document_reviewer(doc.reviewer_id, current_user)
    else:
        assert_assigned_document_participant(
            doc.user_id, doc.reviewer_id, current_user
        )
    return await update_document_status_ctrl(
        db=db,
        document_id=document_id,
        status=status_update.status,
        user_id=current_user.id,
    )


@router.put(
    "/documents/{document_id}/assignee",
    responses={
        403: {
            "description": "Only reviewers and administrators can reassign documents"
        }
    },
)
def update_document_assignee(
    document_id: str,
    assignee_update: DocumentAssigneeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Reassign a document to another outliner reviewer/admin/annotator user."""
    if not is_user_admin_or_reviewer(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only reviewers and administrators can reassign documents",
        )
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    assert_assigned_document_reviewer(doc.reviewer_id, current_user)
    return update_document_assignee_ctrl(
        db=db,
        document_id=document_id,
        user_id=assignee_update.user_id,
    )


@router.get("/documents/{document_id}/progress")
def get_document_progress(
    document_id: str,
    db: Session = Depends(get_db),
):
    """Get progress statistics for a document"""
    return get_document_progress_ctrl(db, document_id)


@router.get("/documents/{document_id}/segment-reviews", response_model=SegmentReviewsResponse)
def get_segment_reviews(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    statuses = get_segment_review_statuses_ctrl(db, document_id, current_user.id)
    return SegmentReviewsResponse(
        document_id=document_id,
        items=[
            SegmentReviewStatusItem(segment_id=segment_id, status=status)
            for segment_id, status in statuses.items()
        ],
    )


@router.post("/documents/{document_id}/sanity-check")
async def post_document_sanity_check(
    document_id: str,
    payload: SanityCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Run the segmentation sanity check against segment spans supplied by the caller.

    The document's full text is read from the database; the segment spans/labels come
    from the request body (the frontend sends what's currently in the editor) rather than
    being re-read from the DB, so the check reflects exactly what the caller sees.
    Read-only: does not submit anything and changes nothing. Available to the assigned
    annotator (before submitting) and to the assigned reviewer (while reviewing), both of
    whom see the check from their own document view.
    """
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    assert_assigned_document_participant(doc.user_id, doc.reviewer_id, current_user)
    segments = [segment.model_dump() for segment in payload.segments]
    return await check_document_sanity_ctrl(db, document_id, segments)


@router.post("/documents/{document_id}/submit-bdrc-in-review")
async def submit_document_to_bdrc_in_review(
    document_id: str,
    payload: SubmitToBdrcRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Push outline to BDRC with status in_review and set document status to completed.

    An optional body carries the annotator's ``is_complete`` decision; omitting it keeps
    the volume complete, which is also BDRC's default.
    """
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    assert_assigned_document_annotator(doc.user_id, current_user)
    is_complete = payload.is_complete if payload is not None else True
    ignore_sanity_warnings = payload.ignore_sanity_warnings if payload is not None else False
    return await submit_document_to_bdrc_in_review_ctrl(
        db, document_id, is_complete, ignore_sanity_warnings
    )


@router.post("/documents/{document_id}/approve")
async def approve_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Approve all segments for a document"""
    doc = fetch_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    assert_assigned_document_reviewer(doc.reviewer_id, current_user)
    return await approve_document_ctrl(db, document_id)


@router.post("/documents/assign_reviewr")
def assign_reviewr(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Assign one random completed unassigned document to the clicking reviewer/admin user."""
    return assign_reviewr_ctrl(
        db=db,
        reviewer=current_user,
    )


@router.post("/documents/{document_id}/assign-reviewer")
def assign_document_reviewer(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_outliner_access),
):
    """Assign the current user as reviewer on this document when it has no reviewer yet."""
    if not is_user_admin_or_reviewer(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only reviewers and administrators can claim document reviews",
        )
    return assign_document_reviewer_ctrl(
        db=db,
        document_id=document_id,
        reviewer=current_user,
    )
