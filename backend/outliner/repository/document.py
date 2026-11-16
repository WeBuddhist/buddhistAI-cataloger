"""SQLAlchemy data access for outliner_document rows."""
import json
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, case, exists, func, not_, or_, select
from sqlalchemy.orm import Session

from user.models.user import User
from outliner.models.outliner import OutlinerDocument, OutlinerSegment, SegmentReview
from outliner.models.ai_outline_run import OutlinerAiOutlineRun
from outliner.repository.segment import (
    _rejection_comment_counts_by_document_ids,
    _rejection_open_segments_by_document_ids,
    _segment_aggregate_counts_by_document_ids,
)
from outliner.repository.segment_rejection import (
    document_ids_with_resolved_reviewer_rejection,
    latest_rejection_notice_by_document_ids,
)


# Placeholder annotator that owns the imported mmBERT test outlines. Nobody works its
# rejected segments, so those documents look stuck in reviewers' lists.
# TEMP: remove with hide_test_rejected once there is a decision on rejected mmBERT docs.
TSENLEK_TEST_USER_ID = "ai-google-oauth2|102282149599861624522"


def list_documents(
    db: Session,
    user_id: Optional[str] = None,
    reviewer_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
    include_approved: bool = False,
    include_skipped: bool = False,
    title: Optional[str] = None,
    exclude_document_user_id: Optional[str] = None,
    hide_test_rejected: bool = False,
    group_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    query = db.query(OutlinerDocument)
    if group_id:
        query = query.filter(OutlinerDocument.group_id == group_id)
    if user_id:
        query = query.filter(OutlinerDocument.user_id == user_id)
    if reviewer_id:
        query = query.filter(OutlinerDocument.reviewer_id == reviewer_id)

    if exclude_document_user_id:
        query = query.filter(
            (OutlinerDocument.user_id != exclude_document_user_id)
            | (OutlinerDocument.user_id.is_(None))
        )
    if status:
        query = query.filter(OutlinerDocument.status == status)

    if title and title.strip():
        escaped = (
            title.strip()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        query = query.filter(OutlinerDocument.filename.ilike(f"%{escaped}%", escape="\\"))

    if not include_deleted:
        query = query.filter(
            (OutlinerDocument.status != "deleted") | (OutlinerDocument.status.is_(None))
        )
    if not include_approved:
        query = query.filter(OutlinerDocument.status != "approved")
    if not include_skipped:
        query = query.filter(OutlinerDocument.status != "skipped")

    # Annotator list: surface docs with open segment rejections first (then newest).
    has_rejected_segment = exists().where(
        and_(
            OutlinerSegment.document_id == OutlinerDocument.id,
            OutlinerSegment.status == "rejected",
        )
    )
    if hide_test_rejected:
        # Only hide once fully reviewed, so reviewers can still finish partly reviewed docs.
        has_pending_segment = exists().where(
            and_(
                OutlinerSegment.document_id == OutlinerDocument.id,
                or_(
                    OutlinerSegment.status.is_(None),
                    OutlinerSegment.status.notin_(["approved", "rejected"]),
                ),
            )
        )
        query = query.filter(
            or_(
                OutlinerDocument.user_id.is_(None),
                OutlinerDocument.user_id != TSENLEK_TEST_USER_ID,
                not_(has_rejected_segment),
                has_pending_segment,
            )
        )
    documents = (
        query.order_by(has_rejected_segment.desc(), OutlinerDocument.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    doc_ids = [d.id for d in documents]
    latest_rejection_by_doc = latest_rejection_notice_by_document_ids(db, doc_ids)
    resolved_rejection_doc_ids = document_ids_with_resolved_reviewer_rejection(db, doc_ids)
    counts_by_doc = _segment_aggregate_counts_by_document_ids(db, doc_ids)
    rejection_comments_by_doc = _rejection_comment_counts_by_document_ids(db, doc_ids)
    rejection_open_segments_by_doc = _rejection_open_segments_by_document_ids(db, doc_ids)

    reviewer_ids = {d.reviewer_id for d in documents if d.reviewer_id}
    reviewer_by_id: Dict[str, Dict[str, Any]] = {}
    if reviewer_ids:
        for uid, name, picture in (
            db.query(User.id, User.name, User.picture)
            .filter(User.id.in_(reviewer_ids))
            .all()
        ):
            reviewer_by_id[str(uid)] = {"name": name, "picture": picture}

    result = []
    for doc in documents:
        agg = counts_by_doc.get(doc.id)
        if agg is None:
            total = checked = unchecked = annotated = rejection_count = 0
            reviewer_changed = 0
        else:
            total = agg["total_segments"]
            checked = agg["checked_segments"]
            unchecked = agg["unchecked_segments"]
            annotated = agg["annotated_segments"]
            rejection_count = agg["rejection_count"]
            reviewer_changed = agg["reviewer_changed_segments"]
        rejection_comment_count = rejection_comments_by_doc.get(doc.id, 0)
        rejection_open_segment_count = rejection_open_segments_by_doc.get(doc.id, 0)
        notice = latest_rejection_by_doc.get(doc.id)
        if (doc.status or "") not in ("approved", "completed"):
            notice = None
        rejection_resolved = doc.id in resolved_rejection_doc_ids
        if (doc.status or "") not in ("approved", "completed"):
            rejection_resolved = False
        reviewer_user = (
            reviewer_by_id.get(str(doc.reviewer_id)) if doc.reviewer_id else None
        )
        result.append(
            {
                "id": doc.id,
                "filename": doc.filename,
                "user_id": doc.user_id,
                "reviewer_id": doc.reviewer_id,
                "reviewer_user": reviewer_user,
                "checked_segments": checked,
                "unchecked_segments": unchecked,
                "total_segments": total,
                "annotated_segments": annotated,
                "rejection_count": rejection_count,
                "rejection_comment_count": rejection_comment_count,
                "rejection_open_segment_count": rejection_open_segment_count,
                "reviewer_changed_segments": reviewer_changed,
                "progress_percentage": (annotated / total) * 100 if total > 0 else 0,
                "status": doc.status,
                "created_at": doc.created_at,
                "updated_at": doc.updated_at,
                "rejected_segment": notice,
                "rejection_resolved": rejection_resolved,
            }
        )

    return result


def fetch_document_workspace_row(
    db: Session, document_id: str
) -> Optional[Any]:
    return (
        db.query(
            OutlinerDocument.id,
            OutlinerDocument.filename,
            OutlinerDocument.status,
        )
        .filter(OutlinerDocument.id == document_id)
        .first()
    )


def fetch_document_by_filename(db: Session, filename: str) -> Optional[OutlinerDocument]:
    return db.query(OutlinerDocument).filter(OutlinerDocument.filename == filename).first()


def insert_document(
    db: Session,
    content: str,
    filename: Optional[str] = None,
    user_id: Optional[str] = None,
    group_id: Optional[str] = None,
    batch_id: Optional[str] = None,
) -> OutlinerDocument:
    db_document = OutlinerDocument(
        id=str(uuid.uuid4()),
        content=content,
        filename=filename,
        user_id=user_id,
        status="active",
        group_id=group_id,
        batch_id=batch_id,
    )
    db.add(db_document)
    db.commit()
    db.refresh(db_document)
    return db_document


def update_document_content(
    db: Session,
    document_id: str,
    content: str,
) -> bool:
    document = db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()
    if not document:
        return False
    document.content = content
    document.updated_at = datetime.utcnow()
    db.commit()
    return True


def delete_document(db: Session, document_id: str) -> bool:
    document = db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()
    if not document:
        return False
    db.delete(document)
    db.commit()
    return True


def fetch_document_by_id(db: Session, document_id: str) -> Optional[OutlinerDocument]:
    return db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()


def fetch_document_reviewer_id(db: Session, document_id: str) -> Optional[str]:
    """Read ``reviewer_id`` directly from DB (avoids stale ORM state on cached document loads)."""
    return (
        db.query(OutlinerDocument.reviewer_id)
        .filter(OutlinerDocument.id == document_id)
        .scalar()
    )


def fetch_documents_by_ids(
    db: Session, document_ids: List[str]
) -> List[OutlinerDocument]:
    return db.query(OutlinerDocument).filter(OutlinerDocument.id.in_(document_ids)).all()


def set_document_status_and_refresh(
    db: Session, document: OutlinerDocument, status: str
) -> None:
    document.status = status
    document.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(document)


def set_document_user_and_refresh(
    db: Session, document: OutlinerDocument, user_id: str
) -> None:
    document.user_id = user_id
    document.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(document)


def set_document_reviewer_and_refresh(
    db: Session, document: OutlinerDocument, reviewer_id: str
) -> None:
    document.reviewer_id = reviewer_id
    document.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(document)


def set_document_synced_to_bdrc(db: Session, document_id: str, synced: bool) -> None:
    document = (
        db.query(OutlinerDocument)
        .filter(OutlinerDocument.id == document_id)
        .first()
    )
    if not document:
        return
    document.synced_to_bdrc = synced
    document.updated_at = datetime.utcnow()
    db.commit()


def set_document_is_complete(db: Session, document_id: str, is_complete: bool) -> None:
    """Record whether the scanned volume is complete; pushed to BDRC on submit."""
    document = (
        db.query(OutlinerDocument)
        .filter(OutlinerDocument.id == document_id)
        .first()
    )
    if not document:
        return
    document.is_complete = is_complete
    document.updated_at = datetime.utcnow()
    db.commit()


def _random_completed_unassigned_document(
    db: Session,
    *,
    user_ids: Optional[List[str]] = None,
    exclude_user_id: Optional[str] = None,
    group_ids: Optional[List[str]] = None,
) -> Optional[OutlinerDocument]:
    query = db.query(OutlinerDocument).filter(
        OutlinerDocument.status == "completed",
        OutlinerDocument.reviewer_id.is_(None),
    )
    if group_ids is not None:
        # Documents from before groups (no group) can still be reviewed by anyone.
        query = query.filter(
            or_(OutlinerDocument.group_id.in_(group_ids), OutlinerDocument.group_id.is_(None))
        )
    if user_ids is not None:
        query = query.filter(OutlinerDocument.user_id.in_(user_ids))
    if exclude_user_id is not None:
        # A reviewer must not review a document they annotated.
        query = query.filter(OutlinerDocument.user_id != exclude_user_id)
    return query.order_by(func.random()).first()


def fetch_random_completed_unassigned_document(
    db: Session,
    exclude_user_id: Optional[str] = None,
    group_ids: Optional[List[str]] = None,
) -> Optional[OutlinerDocument]:
    """Pick a completed, unassigned document for reviewer self-assign.

    Selection is uniformly random across all eligible documents, so no
    annotator is favored over another.

    Documents annotated by ``exclude_user_id`` (the requesting reviewer) are
    never returned, so a reviewer cannot be assigned their own work.

    With ``group_ids``, only documents of those groups (or with no group) are picked.
    """
    return _random_completed_unassigned_document(
        db, exclude_user_id=exclude_user_id, group_ids=group_ids
    )


# Spot checks favour recent work, so new reviewers' documents come up instead of being
# lost among months of older approved documents.
SPOT_CHECK_RECENT_DAYS = 10


def fetch_random_reviewed_document_ids(
    db: Session, limit: int = 5, recent_days: int = SPOT_CHECK_RECENT_DAYS
) -> List[Tuple[str, Optional[str]]]:
    """Return up to ``limit`` random (id, filename) pairs with status ``approved`` (fully reviewed).

    Picks first among documents reviewed in the last ``recent_days`` (a segment's
    ``reviewed_at`` in that window); only when there are fewer than ``limit`` of those
    is the rest filled with older approved documents, also at random.

    Excludes legacy "Unknown" documents that have no reviewer on the document,
    no reviewed_by_id on any segment, and no segment_reviews rows.
    """
    has_doc_reviewer = OutlinerDocument.reviewer_id.isnot(None)
    has_segment_reviewer = exists(
        select(OutlinerSegment.id)
        .where(OutlinerSegment.document_id == OutlinerDocument.id)
        .where(OutlinerSegment.reviewed_by_id.isnot(None))
    )
    has_review_decision = exists(
        select(SegmentReview.id)
        .where(SegmentReview.document_id == OutlinerDocument.id)
    )
    reviewed_recently = exists(
        select(OutlinerSegment.id)
        .where(OutlinerSegment.document_id == OutlinerDocument.id)
        .where(OutlinerSegment.reviewed_at >= datetime.utcnow() - timedelta(days=recent_days))
    )

    def pick(recent: bool, n: int) -> List[Tuple[str, Optional[str]]]:
        rows = (
            db.query(OutlinerDocument.id, OutlinerDocument.filename)
            .filter(
                OutlinerDocument.status == "approved",
                or_(has_doc_reviewer, has_segment_reviewer, has_review_decision),
                reviewed_recently if recent else not_(reviewed_recently),
            )
            .order_by(func.random())
            .limit(n)
            .all()
        )
        return [(row[0], row[1]) for row in rows]

    picked = pick(True, limit)
    if len(picked) < limit:
        picked += pick(False, limit - len(picked))
    return picked


def increment_document_submit_count(db: Session, document_id: str) -> None:
    """Bump review submit counter when admin approves the full document (POST .../approve)."""
    document = db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()
    if not document:
        return
    document.submit_count = (document.submit_count or 0) + 1
    document.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(document)


def get_document_progress(
    db: Session, document_id: str
) -> Optional[Dict[str, Any]]:
    document = db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()
    if not document:
        return None
    checked = db.query(func.count(OutlinerSegment.id)).filter(
        OutlinerSegment.document_id == document_id,
        or_(
            OutlinerSegment.status == "checked",
            OutlinerSegment.status == "approved",
        ),
    ).scalar()

    unchecked = db.query(func.count(OutlinerSegment.id)).filter(
        OutlinerSegment.document_id == document_id,
        or_(
            OutlinerSegment.status.is_(None),
            and_(
                OutlinerSegment.status != "checked",
                OutlinerSegment.status != "approved",
            ),
        ),
    ).scalar()

    return {
        "document_id": document_id,
        "checked_segments": checked or 0,
        "unchecked_segments": unchecked or 0,
        "updated_at": document.updated_at,
    }


def reset_segments(db: Session, document_id: str) -> bool:
    document = db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()
    
    if not document:
        return False
    db.query(OutlinerSegment).filter(OutlinerSegment.document_id == document_id).delete()
    document.status = "active"
    document.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(document)
    return True


def replace_segments_and_ai_toc(
    db: Session,
    document: OutlinerDocument,
    db_segments: List[OutlinerSegment],
    normalized_toc: Any,
) -> None:
    db.query(OutlinerSegment).filter(OutlinerSegment.document_id == document.id).delete(
        synchronize_session=False
    )
    if isinstance(normalized_toc, dict):
        document.ai_toc_entries = json.dumps(normalized_toc, ensure_ascii=False)
    else:
        document.ai_toc_entries = normalized_toc
    document.updated_at = datetime.utcnow()
    db.add_all(db_segments)
    db.commit()


def insert_ai_outline_run(
    db: Session,
    document_id: str,
    segments: List[Dict[str, Any]],
    created_by_id: Optional[str] = None,
    detector: str = "rule",
) -> OutlinerAiOutlineRun:
    """Insert a frozen snapshot of the AI's predicted segment split (one row per AI click)."""
    run = OutlinerAiOutlineRun(
        document_id=document_id,
        segments=segments,
        detector=detector,
        created_by_id=created_by_id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def save_annotator_ai_final_segments(
    db: Session,
    document_id: str,
    segments: List[Dict[str, Any]],
) -> bool:
    """Overwrite the annotator's final submitted segment snapshot on the document."""
    document = db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()
    if not document:
        return False
    document.annotator_ai_final_segments = segments
    document.updated_at = datetime.utcnow()
    db.commit()
    return True


def list_ai_outline_runs_for_document(
    db: Session,
    document_id: str,
) -> List[OutlinerAiOutlineRun]:
    """All AI outline runs for a document, newest first."""
    return (
        db.query(OutlinerAiOutlineRun)
        .filter(OutlinerAiOutlineRun.document_id == document_id)
        .order_by(OutlinerAiOutlineRun.created_at.desc())
        .all()
    )


def document_has_ai_outline_run(db: Session, document_id: str) -> bool:
    """True if the AI outline button was used on this document at least once."""
    return db.query(
        db.query(OutlinerAiOutlineRun)
        .filter(OutlinerAiOutlineRun.document_id == document_id)
        .exists()
    ).scalar()


def bdrc_modified_by_from_document(
    db: Session, document: OutlinerDocument
) -> Optional[str]:
    if not document.user_id:
        return None
    user = db.query(User).filter(User.id == document.user_id).first()
    if not user:
        return None
    email = (user.email or "").strip()
    if email:
        return email
    return (user.id or "").strip() or None


def list_completed_document_ids_all_segments_checked(
    db: Session,
    only_document_ids: Optional[List[str]] = None,
) -> List[str]:
    segment_not_checked = exists().where(
        OutlinerSegment.document_id == OutlinerDocument.id,
        or_(
            OutlinerSegment.status.is_(None),
            OutlinerSegment.status != "checked",
        ),
    )
    has_segments = exists().where(
        OutlinerSegment.document_id == OutlinerDocument.id,
    )
    q = db.query(OutlinerDocument.id).filter(
        OutlinerDocument.status == "completed",
        OutlinerDocument.filename.isnot(None),
        OutlinerDocument.filename != "",
        ~segment_not_checked,
        has_segments,
    )
    if only_document_ids is not None:
        if not only_document_ids:
            return []
        q = q.filter(OutlinerDocument.id.in_(only_document_ids))
    rows = q.all()
    return [r[0] for r in rows]


def allow_user_to_assign_volume(db: Session, user_id: str) -> bool:
    allowed_doc_statuses = ("skipped", "completed", "approved", "deleted")
    incomplete_segment_exists = select(OutlinerSegment.id).where(
        OutlinerSegment.document_id == OutlinerDocument.id,
        OutlinerSegment.status.in_(("rejected", "unchecked")),
    ).exists()

    row = db.execute(
        select(
            func.count(OutlinerDocument.id).label("doc_count"),
            func.max(
                case((OutlinerDocument.status == "active", 1), else_=0)
            ).label("has_active"),
            func.max(
                case(
                    (
                        or_(
                            OutlinerDocument.status.is_(None),
                            OutlinerDocument.status.notin_(allowed_doc_statuses),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("has_bad_status"),
            func.max(
                case(
                    (
                        and_(
                            OutlinerDocument.status == "completed",
                            incomplete_segment_exists,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("has_incomplete_on_completed"),
        ).where(OutlinerDocument.user_id == user_id)
    ).one()

    if row.doc_count == 0:
        return True

    return not bool(
        row.has_active or row.has_bad_status or row.has_incomplete_on_completed
    )



def map_document_id_to_filename(
    db: Session, document_ids: List[str]
) -> Dict[str, str]:
    id_to_filename: Dict[str, str] = {}
    if not document_ids:
        return id_to_filename
    for row in (
        db.query(OutlinerDocument.id, OutlinerDocument.filename)
        .filter(OutlinerDocument.id.in_(document_ids))
        .all()
    ):
        id_to_filename[row[0]] = (row[1] or "").strip()
    return id_to_filename
