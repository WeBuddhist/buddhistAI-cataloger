"""ORM model for outliner_segments."""
from __future__ import annotations

from datetime import datetime
import uuid

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from user.models.user import User

from outliner.models.segment_enums import SegmentLabels


class OutlinerSegment(Base):
    """Stores individual segments with their annotations and metadata."""

    __tablename__ = "outliner_segments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("outliner_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    text: Mapped[str] = mapped_column(Text, nullable=False)
    segment_index: Mapped[int] = mapped_column(Integer, nullable=False)
    span_start: Mapped[int] = mapped_column(Integer, nullable=False)
    span_end: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[SegmentLabels | None] = mapped_column(Enum(SegmentLabels), nullable=True)

    title: Mapped[str | None] = mapped_column(String, nullable=True)
    title_span_start: Mapped[int] = mapped_column(Integer, nullable=True)
    title_span_end: Mapped[int] = mapped_column(Integer, nullable=True)
    updated_title: Mapped[str | None] = mapped_column(String, nullable=True)
    is_supplied_title: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)
    author: Mapped[str | None] = mapped_column(String, nullable=True)
    author_span_start: Mapped[int] = mapped_column(Integer, nullable=True)
    author_span_end: Mapped[int] = mapped_column(Integer, nullable=True)
    updated_author: Mapped[str | None] = mapped_column(String, nullable=True)
    pre_review_title: Mapped[str | None] = mapped_column(String, nullable=True)
    pre_review_author: Mapped[str | None] = mapped_column(String, nullable=True)
    reviewer_title: Mapped[str | None] = mapped_column(String, nullable=True)
    reviewer_author: Mapped[str | None] = mapped_column(String, nullable=True)
    title_bdrc_id: Mapped[str | None] = mapped_column(String, nullable=True)
    author_bdrc_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Indexed: deleting a segment looks up its children here (FK SET NULL + child_segments);
    # without it every delete, merge and split read the whole table.
    parent_segment_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("outliner_segments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    reviewed_by_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Indexed: spot checks look up recently reviewed documents by it.
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    # NULL = the document's annotator. A reviewer id means the reviewer added this segment
    # (split during review) and it counts toward the reviewer, not the annotator.
    created_by_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # The reviewer split/merged this annotator segment; counted as an edit, like a title fix.
    corrected_by_reviewer: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # What the reviewer's merges removed from this segment, so the annotator's segment can be
    # put back (Undo merge, or a re-split at the same spot). One entry per removed boundary,
    # keyed by its document offset; see outliner.controller.merge_restore. NULL = nothing.
    merge_history: Mapped[list | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    is_annotated: Mapped[bool] = mapped_column(default=False)
    comment: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    is_attached: Mapped[bool] = mapped_column(default=False, nullable=True)

    document: Mapped["OutlinerDocument"] = relationship("OutlinerDocument", back_populates="segments")
    parent_segment: Mapped["OutlinerSegment | None"] = relationship(
        "OutlinerSegment",
        remote_side=[id],
        backref="child_segments",
    )

    __table_args__ = (
        Index("ix_outliner_segments_document_index", "document_id", "segment_index"),
        Index("ix_outliner_segments_span", "document_id", "span_start", "span_end"),
        # Document lists and dashboard counts filter segments by document and status.
        Index("ix_outliner_segments_document_status", "document_id", "status"),
    )

    rejections: Mapped[list["SegmentRejection"]] = relationship(
        "SegmentRejection",
        back_populates="segment",
        cascade="all, delete-orphan",
        order_by="SegmentRejection.created_at",
    )
    reviewed_by_user: Mapped[User | None] = relationship(
        User,
        foreign_keys=[reviewed_by_id],
    )

    def update_annotation_status(self):
        """Update is_annotated flag based on title/author presence."""
        self.is_annotated = bool(self.title or self.author)
