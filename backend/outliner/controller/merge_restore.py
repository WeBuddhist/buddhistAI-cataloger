"""Undo a reviewer's merge: put the annotator's segment (and its credit) back.

When the reviewer merges segments during review, the surviving segment remembers what each
merge removed in ``merge_history`` -- one record per removed boundary:

    {
        "position": <document offset where the removed segment started>,
        "merged_at": <iso time>, "merged_by_id": <reviewer id>,
        "upper": {<the segment above the boundary before the merge>},
        "merged_title": ..., "merged_author": ...,   # what the merge left on the survivor
        "removed": {<the removed segment's fields, id, credit and created_at>},
    }

The segment is put back by "Undo merge" (latest record) or when the reviewer splits again
within ``RESTORE_LEEWAY_CHARS`` of a recorded boundary. A restored segment keeps its original
credit (``created_by_id``) and ``created_at``, so it never counts toward the reviewer's split
limit unless it was the reviewer's own segment to begin with.

"Corrected by reviewer" describes the segment as it is now, not the steps taken: an annotator
segment is marked only while its start or end differs from the annotator's outline, so a
reviewer who splits/merges and then puts everything back leaves no mark
(see ``refresh_reviewer_marks``).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from outliner.models.outliner import OutlinerDocument, OutlinerSegment, SegmentLabels
from outliner.repository import outliner_repository as outliner_repo
from outliner.repository.segment import review_round_start

# A re-split this close to the annotator's original boundary puts it back, exactly there.
RESTORE_LEEWAY_CHARS = 5

_REMOVED_FIELDS = (
    "id",
    "title",
    "title_span_start",
    "title_span_end",
    "updated_title",
    "is_supplied_title",
    "author",
    "author_span_start",
    "author_span_end",
    "updated_author",
    "pre_review_title",
    "pre_review_author",
    "reviewer_title",
    "reviewer_author",
    "title_bdrc_id",
    "author_bdrc_id",
    "parent_segment_id",
    "status",
    "reviewed_by_id",
    "created_by_id",
    "corrected_by_reviewer",
    "comment",
    "is_attached",
)
_UPPER_FIELDS = ("span_start", "title", "author", "title_bdrc_id", "author_bdrc_id")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


def _snapshot_removed(seg: OutlinerSegment) -> Dict[str, Any]:
    data = {name: getattr(seg, name) for name in _REMOVED_FIELDS}
    data["label"] = seg.label.name if seg.label else None
    data["reviewed_at"] = _iso(seg.reviewed_at)
    data["created_at"] = _iso(seg.created_at)
    return data


def history_of(seg: OutlinerSegment) -> List[Dict[str, Any]]:
    """Records whose boundary is still strictly inside the segment (others are stale)."""
    return [
        r
        for r in (seg.merge_history or [])
        if seg.span_start < r.get("position", -1) < seg.span_end
    ]


def restore_positions(seg: OutlinerSegment) -> List[int]:
    """Document offsets where an annotator segment can be put back (for the review page)."""
    return sorted(r["position"] for r in history_of(seg))


def _set_history(seg: OutlinerSegment, records: List[Dict[str, Any]]) -> None:
    # Assign a fresh list (never mutate in place) so SQLAlchemy sees the JSON change.
    seg.merge_history = [dict(r) for r in records] or None


def merge_history_for(
    segments: List[OutlinerSegment],
    reviewer_id: Optional[str],
    merged_title: Optional[str],
    merged_author: Optional[str],
) -> Optional[List[Dict[str, Any]]]:
    """History for the survivor of merging ``segments`` (in order). Call before changing them.

    Earlier records of every merged segment are kept. Only a reviewer's merge of someone
    else's segment adds new ones: an annotator merging their own segments in the workspace is
    not a correction to undo, and a reviewer merging away a segment they split off themselves
    is just taking back their own split (re-splitting there is a normal, counted split).
    """
    records: List[Dict[str, Any]] = []
    for seg in segments:
        records.extend(history_of(seg))
    if reviewer_id:
        now = datetime.utcnow().isoformat()
        for upper, removed in zip(segments, segments[1:]):
            if removed.created_by_id == reviewer_id:
                continue
            records.append(
                {
                    "position": removed.span_start,
                    "merged_at": now,
                    "merged_by_id": reviewer_id,
                    "upper": {name: getattr(upper, name) for name in _UPPER_FIELDS},
                    "merged_title": merged_title,
                    "merged_author": merged_author,
                    "removed": _snapshot_removed(removed),
                }
            )
    return records or None


def find_restore_record(
    seg: OutlinerSegment, split_offset: int
) -> Optional[Dict[str, Any]]:
    """The record whose boundary a split at ``split_offset`` (within the segment) puts back."""
    position = seg.span_start + split_offset
    near = [
        r for r in history_of(seg) if abs(r["position"] - position) <= RESTORE_LEEWAY_CHARS
    ]
    return min(near, key=lambda r: abs(r["position"] - position)) if near else None


def latest_record(seg: OutlinerSegment) -> Optional[Dict[str, Any]]:
    """The merge "Undo merge" reverses: the newest, and the lowest boundary of that merge."""
    records = history_of(seg)
    if not records:
        return None
    return max(records, key=lambda r: (r.get("merged_at") or "", r["position"]))


def split_history(
    records: List[Dict[str, Any]],
    seg: OutlinerSegment,
    new_seg: OutlinerSegment,
    position: int,
) -> None:
    """Share ``records`` (``history_of(seg)`` taken before the split) between the two halves
    of a plain split at document offset ``position``."""
    _set_history(seg, [r for r in records if r["position"] < position])
    _set_history(new_seg, [r for r in records if r["position"] > position])


def _owned_by_annotator(created_by_id: Optional[str], owner_id: Optional[str]) -> bool:
    return created_by_id is None or created_by_id == owner_id


def refresh_reviewer_marks(
    db: Session, document_id: str, segments: List[OutlinerSegment]
) -> None:
    """Set "corrected by reviewer" on ``segments`` from how they look now.

    The annotator's outline is every start of an annotator segment, plus the starts of
    annotator segments the reviewer merged away (kept in ``merge_history``), plus both ends of
    the document. Reviewer splits/merges never change that set, so only the segments they
    touched need checking: an annotator segment is marked while it does not start and end on
    the annotator's outline or has one of its boundaries inside it.
    """
    db.flush()  # the session does not autoflush; read the split/merge as it is now
    owner_id = (
        db.query(OutlinerDocument.user_id).filter(OutlinerDocument.id == document_id).scalar()
    )
    rows = (
        db.query(
            OutlinerSegment.span_start,
            OutlinerSegment.span_end,
            OutlinerSegment.created_by_id,
            OutlinerSegment.merge_history,
        )
        .filter(OutlinerSegment.document_id == document_id)
        .all()
    )
    if not rows:
        return
    outline = {0, max(r.span_end for r in rows)}
    for r in rows:
        if _owned_by_annotator(r.created_by_id, owner_id):
            outline.add(r.span_start)
        outline.update(
            rec["position"]
            for rec in r.merge_history or []
            if r.span_start < rec.get("position", -1) < r.span_end
        )
    for seg in segments:
        if not _owned_by_annotator(seg.created_by_id, owner_id):
            seg.corrected_by_reviewer = False  # the reviewer's own segment is credited to them
            continue
        matches = (
            seg.span_start in outline
            and seg.span_end in outline
            and not any(seg.span_start < b < seg.span_end for b in outline)
        )
        seg.corrected_by_reviewer = not matches


def _restore_upper(seg: OutlinerSegment, record: Dict[str, Any]) -> None:
    """Give the segment above the boundary its own title/author back."""
    upper = record.get("upper") or {}
    if seg.span_start != upper.get("span_start"):
        return  # Not the segment that was above this boundary (part of a bigger merge).
    for field, merged_key in (("title", "merged_title"), ("author", "merged_author")):
        # Only if the reviewer has not edited it since the merge.
        if getattr(seg, field) == record.get(merged_key):
            setattr(seg, field, upper.get(field))
            setattr(seg, f"{field}_bdrc_id", upper.get(f"{field}_bdrc_id"))


def _rebuild_removed(
    db: Session, seg: OutlinerSegment, removed: Dict[str, Any], position: int
) -> OutlinerSegment:
    """The removed segment again, from ``position`` to the end of ``seg`` (before the split)."""
    seg_id = removed.get("id")
    if not seg_id or outliner_repo.get_segment_by_pk(db, seg_id) is not None:
        seg_id = str(uuid.uuid4())
    parent_id = removed.get("parent_segment_id")
    if parent_id and outliner_repo.get_segment_by_pk(db, parent_id) is None:
        parent_id = None
    # The merge deleted this segment's rejection notes; "rejected" without one is unexplained.
    status = removed.get("status") or "unchecked"
    if status == "rejected":
        status = "unchecked"
    label = removed.get("label")
    copied = {
        name: removed.get(name)
        for name in _REMOVED_FIELDS
        if name not in ("id", "parent_segment_id", "status", "corrected_by_reviewer")
    }
    return OutlinerSegment(
        **copied,
        id=seg_id,
        document_id=seg.document_id,
        text="",
        segment_index=seg.segment_index + 1,
        span_start=position,
        span_end=seg.span_end,
        label=SegmentLabels[label] if label else None,
        parent_segment_id=parent_id,
        status=status,
        reviewed_at=_parse_iso(removed.get("reviewed_at")),
        created_at=_parse_iso(removed.get("created_at")) or datetime.utcnow(),
    )


def restore_segment(
    db: Session, seg: OutlinerSegment, record: Dict[str, Any], commit: bool = True
) -> OutlinerSegment:
    """Split ``seg`` exactly at the annotator's boundary in ``record`` and rebuild the removed
    segment below it, with its original fields and credit."""
    position = record["position"]
    if not seg.span_start < position < seg.span_end:
        raise HTTPException(status_code=400, detail="Invalid split position for segment span")

    key = (position, record.get("merged_at"))
    remaining = [r for r in history_of(seg) if (r["position"], r.get("merged_at")) != key]

    new_seg = _rebuild_removed(db, seg, record["removed"], position)
    _set_history(new_seg, [r for r in remaining if r["position"] > position])
    seg.text = ""
    seg.span_end = position
    _restore_upper(seg, record)
    _set_history(seg, [r for r in remaining if r["position"] < position])

    outliner_repo.execute_bump_segment_indices_after(db, seg.document_id, seg.segment_index)
    outliner_repo.add_segment(db, new_seg)
    refresh_reviewer_marks(db, seg.document_id, [seg, new_seg])
    seg.update_annotation_status()
    new_seg.update_annotation_status()
    if commit:
        outliner_repo.commit_session(db)
    return new_seg


def undo_last_merge(db: Session, segment_id: str) -> OutlinerSegment:
    """Reverse the newest merge on the segment; returns the segment put back."""
    seg = outliner_repo.get_segment_by_pk(db, segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail="Segment not found")
    record = latest_record(seg)
    if record is None:
        raise HTTPException(status_code=400, detail="This segment has no merge to undo")
    return restore_segment(db, seg, record)


def _ordered_segments(db: Session, document_id: str) -> List[OutlinerSegment]:
    db.flush()
    db.expire_all()  # segment indices were shifted with plain UPDATEs
    return (
        db.query(OutlinerSegment)
        .filter(OutlinerSegment.document_id == document_id)
        .order_by(OutlinerSegment.segment_index)
        .all()
    )


def _fold_into_neighbour(db: Session, seg: OutlinerSegment, segments: List[OutlinerSegment]) -> OutlinerSegment:
    """Delete ``seg`` and give its text to the segment above (or below, if it is first)."""
    i = segments.index(seg)
    keeper = segments[i - 1] if i > 0 else segments[i + 1]
    if keeper.span_start < seg.span_start:
        keeper.span_end = seg.span_end
    else:
        keeper.span_start = seg.span_start
    keeper.text = ""
    _set_history(keeper, (keeper.merge_history or []) + (seg.merge_history or []))
    keeper.update_annotation_status()
    db.delete(seg)
    db.flush()
    db.execute(
        update(OutlinerSegment)
        .where(
            OutlinerSegment.document_id == seg.document_id,
            OutlinerSegment.segment_index > seg.segment_index,
        )
        .values(segment_index=OutlinerSegment.segment_index - 1)
    )
    return keeper


def reset_to_annotator(db: Session, document_id: str) -> Dict[str, int]:
    """Put the outline back exactly as the annotator sent it for this review round: every
    annotator segment the reviewer merged away comes back, and every segment the reviewer
    split off is joined back to the segment above. Titles, authors and approve/reject
    decisions on the annotator's segments are kept. Commits once at the end.
    """
    owner_id = (
        db.query(OutlinerDocument.user_id).filter(OutlinerDocument.id == document_id).scalar()
    )
    round_start = review_round_start(db, document_id)
    since = round_start.isoformat() if round_start else ""

    def this_round(record: Dict[str, Any]) -> bool:
        return (record.get("merged_at") or "") > since

    touched: set[str] = set()
    restored = removed = 0

    # 1. Bring back the annotator segments merged away, newest merge first.
    while True:
        candidates = [
            (seg, max(recs, key=lambda r: (r.get("merged_at") or "", r["position"])))
            for seg in _ordered_segments(db, document_id)
            if (recs := [r for r in history_of(seg) if this_round(r)])
        ]
        if not candidates:
            break
        seg, record = candidates[0]
        new_seg = restore_segment(db, seg, record, commit=False)
        touched.update((seg.id, new_seg.id))
        restored += 1

    # 2. Join the reviewer's own segments from this round back into their neighbour.
    while True:
        segments = _ordered_segments(db, document_id)
        added = [
            seg
            for seg in segments
            if not _owned_by_annotator(seg.created_by_id, owner_id)
            and (round_start is None or seg.created_at > round_start)
        ]
        if not added or len(segments) < 2:
            break
        keeper = _fold_into_neighbour(db, added[0], segments)
        touched.discard(added[0].id)
        touched.add(keeper.id)
        removed += 1

    segments = [s for s in _ordered_segments(db, document_id) if s.id in touched]
    refresh_reviewer_marks(db, document_id, segments)
    outliner_repo.commit_session(db)
    return {"restored": restored, "removed": removed}
