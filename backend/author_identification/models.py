"""ORM models for Author Identification.

* ``author_identification_answers``      every answer, append-only, each with its own sync state
* ``author_identification_active_time``  time each person spent on each text
* ``author_identification_assignments``  which person each text was handed to

Answers are saved here first, then the latest answer of each text is sent to BDRC's
editions API by ``author_identification.sync_worker``, which retries while BDRC is
unreachable. BDRC keeps one current answer per text (and its own history); this table keeps
every answer anyone saved.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base

ROLE_ANNOTATOR = "annotator"

# Sync states for an answer.
SYNC_PENDING = "pending"
SYNC_RUNNING = "running"
SYNC_SUCCEEDED = "succeeded"
SYNC_FAILED = "failed"
# A newer answer on the same text replaced this one before it was sent; BDRC keeps one
# answer per text, so only the latest is sent.
SYNC_SUPERSEDED = "superseded"

# Backoff between send attempts while BDRC is unreachable, in seconds; after the last
# one, every 6 hours until it is delivered.
RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600, 21600]


def _uuid() -> str:
    return str(uuid.uuid4())


class AuthorAnswer(Base):
    """One answer as it was saved. A new save adds a row; the newest row of a text is its
    current answer."""

    __tablename__ = "author_identification_answers"
    __table_args__ = (Index("ix_author_identification_answers_item", "batch_id", "item_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # BDRC's batch and item ids, and the edition (text) the item is about.
    batch_id: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[int] = mapped_column(Integer, nullable=False)
    edition_id: Mapped[str | None] = mapped_column(String, nullable=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default=ROLE_ANNOTATOR, server_default=ROLE_ANNOTATOR)

    # The answer, as BDRC's PUT /editions/batches/{batch}/items/{item} takes it.
    person_answer: Mapped[str | None] = mapped_column(String, nullable=True)  # bdrc / not_in_bdrc / unknown
    p_id: Mapped[str | None] = mapped_column(String, nullable=True)
    name_bo: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    text_rejected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The persons of the text, each in a role, as BDRC's editions API takes them
    # ({person_answer, p_id | name_bo, role, role_other?}, plus person_name to show here).
    # person_answer, p_id and name_bo above repeat the first one.
    persons: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # Sending to BDRC.
    sync_state: Mapped[str] = mapped_column(String, nullable=False, default=SYNC_PENDING, index=True)
    sync_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class AuthorAssignment(Base):
    """A text handed to one person ("Assign work"); one person per text. Finished when that
    person saves an answer on it."""

    __tablename__ = "author_identification_assignments"

    batch_id: Mapped[str] = mapped_column(String, primary_key=True)
    item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    edition_id: Mapped[str | None] = mapped_column(String, nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AuthorActiveTime(Base):
    """Seconds a person spent on a text (on screen and in use), summed over every visit."""

    __tablename__ = "author_identification_active_time"

    batch_id: Mapped[str] = mapped_column(String, primary_key=True)
    item_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), primary_key=True, index=True)
    seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class AuthorDuplicateReport(Base):
    """Two BDRC persons reported as one and the same, noticed on a text. When one of them is
    a person of that text's answer, the other goes to BDRC with it (``data.duplicate_p_ids``).
    An admin decides later whether they are the same; nothing changes in BDRC by the report."""

    __tablename__ = "author_identification_duplicate_reports"
    __table_args__ = (Index("ix_author_identification_duplicates_item", "batch_id", "item_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # The text it was noticed on.
    batch_id: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[int] = mapped_column(Integer, nullable=False)
    text_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)

    # The two persons, with their names and dates as seen, to list the report without BDRC.
    person_id: Mapped[str] = mapped_column(String, nullable=False)
    person_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    person_dates: Mapped[str | None] = mapped_column(Text, nullable=True)
    other_id: Mapped[str] = mapped_column(String, nullable=False)
    other_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    other_dates: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    # An admin's decision: "same" or "different"; null while open.
    decision: Mapped[str | None] = mapped_column(String, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
