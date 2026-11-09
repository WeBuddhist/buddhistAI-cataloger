"""ORM models for the dedup review tool.

* ``dedup_items``          a copy of each BDRC review item an annotator has claimed
* ``dedup_assignments``    which annotators an item belongs to (two slots per item)
* ``dedup_decisions``      every decision, append-only, each with its own sync state
* ``dedup_adjudications``  pairs whose two answers disagree, and who settles them
* ``dedup_settings``       tool-wide settings an admin changes (e.g. review mode)
* ``dedup_voice_notes``    the S3 recording behind each spoken note

Double review: two annotators answer each pair without seeing each other's answer. If
their verdicts match, that verdict is final; otherwise the pair goes to an adjudicator,
whose answer is final. Only the final answer is pushed to BDRC, by
``dedup.sync_worker``, which retries while BDRC is unreachable. Items claimed before
double review (``review_mode = single``) keep one annotator whose answer is final.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base

MODE_SINGLE = "single"
MODE_DOUBLE = "double"
REVIEW_MODES = (MODE_SINGLE, MODE_DOUBLE)
# Setting: how pairs handed out from now on are reviewed. Unset means double.
SETTING_REVIEW_MODE = "review_mode"
SLOTS = (1, 2)

ROLE_ANNOTATOR = "annotator"
ROLE_ADJUDICATOR = "adjudicator"
# An admin overriding the final answer from the admin pair page. Final over every other
# answer, and the pair is locked for annotators and adjudicators from then on.
ROLE_ADMIN_CORRECTION = "admin_correction"

# How an adjudicated pair was settled.
SIDED_WITH_1 = "sided_with_1"
SIDED_WITH_2 = "sided_with_2"
NEW_LABEL = "new_label"
UNRESOLVED = "unresolved"
# A final check of a pair both annotators answered alike: the adjudicator kept their
# answer, or replaced it.
CONFIRMED = "confirmed"
OVERRULED = "overruled"
# An admin corrected the pair before or after the adjudicator answered.
ADMIN_CORRECTED = "admin_corrected"

# Sync states for a decision.
# An annotator's answer on a double-review pair: kept here, never sent to BDRC.
SYNC_LOCAL = "local"
SYNC_PENDING = "pending"
SYNC_RUNNING = "running"
SYNC_SUCCEEDED = "succeeded"
SYNC_FAILED = "failed"
# A newer decision on the same item replaced this one before it was sent; BDRC keeps
# one verdict per item, so only the latest decision is pushed.
SYNC_SUPERSEDED = "superseded"

# Backoff between push attempts, in seconds; a decision that exhausts these is failed.
RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600, 21600]
MAX_ATTEMPTS = len(RETRY_BACKOFF_SECONDS) + 1


def _uuid() -> str:
    return str(uuid.uuid4())


class DedupItem(Base):
    """Copy of one BDRC review item (a pair), taken when it is claimed."""

    __tablename__ = "dedup_items"

    # Same id as BDRC's review_item.item_id, so the two can be matched directly.
    item_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    batch_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String, nullable=False, default="pair")
    subject: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # sha256 of the evidence as shown, so a decision can be traced to exactly what the
    # annotator saw even if BDRC's copy changes later (plan §5, decision.evidence_hash).
    evidence_hash: Mapped[str] = mapped_column(String, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    review_mode: Mapped[str] = mapped_column(String, nullable=False, default=MODE_DOUBLE, server_default=MODE_DOUBLE)


class DedupAssignment(Base):
    """One annotator slot on an item.

    Up to two per item (``slot`` 1 and 2), never both to the same person. An admin
    reassigning later updates ``user_id`` on the same row; ``assigned_by`` records who
    handed it out.
    """

    __tablename__ = "dedup_assignments"
    # Named to match the migration; also what stops two people claiming one slot.
    __table_args__ = (
        UniqueConstraint("item_id", "slot", name="uq_dedup_assignments_item_slot"),
        UniqueConstraint("item_id", "user_id", name="uq_dedup_assignments_item_user"),
        CheckConstraint("slot IN (1, 2)", name="ck_dedup_assignments_slot"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("dedup_items.item_id"), nullable=False)
    slot: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    batch_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    assigned_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    first_opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DedupActiveTime(Base):
    """Time one annotator spent working on one pair: on screen and in use, summed over
    every visit (idle time is not counted). Kept per person, so a pair moved to someone
    else keeps the first person's time. Task-time measurement for the plan (§10)."""

    __tablename__ = "dedup_active_time"

    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("dedup_items.item_id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), primary_key=True, index=True)
    seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class DedupDecision(Base):
    """One decision on one item. Append-only: changing a verdict adds a new row."""

    __tablename__ = "dedup_decisions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("dedup_items.item_id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default=ROLE_ANNOTATOR, server_default=ROLE_ANNOTATOR)
    # The answer BDRC gets. False for an annotator's answer on a double-review pair.
    is_final: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Adjudicator's or correcting admin's optional note on why they decided as they did.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The fields sent to BDRC with PUT /review/items/{item_id}.
    status: Mapped[str] = mapped_column(String, nullable=False)
    verdict: Mapped[str | None] = mapped_column(String, nullable=True)
    abstention_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The full issue list for the item; BDRC's PUT replaces the list, never appends.
    issues: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    partner_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    evidence_hash: Mapped[str] = mapped_column(String, nullable=False)

    # Push to BDRC.
    sync_state: Mapped[str] = mapped_column(String, nullable=False, default=SYNC_PENDING, index=True)
    sync_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class DedupAdjudication(Base):
    """A double-review pair whose two answers disagree (including any "can't answer").

    Created when the second answer comes in. ``user_id`` is the adjudicator who took it
    (first to open it); an admin can release it. Never one of the pair's annotators.
    """

    __tablename__ = "dedup_adjudications"

    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("dedup_items.item_id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True, index=True)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    first_opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # sided_with_1 | sided_with_2 | new_label | unresolved (set with completed_at).
    resolution: Mapped[str | None] = mapped_column(String, nullable=True)


class DedupSetting(Base):
    """One tool-wide setting, changed by an admin."""

    __tablename__ = "dedup_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class DedupVoiceNote(Base):
    """The recording behind a spoken note, kept in S3. The note's text (as the user
    corrected it) stays in the decision's ``partner_payload.notes``, which points here by
    ``voice_note_ids`` (a note edited with the mic gains one more). The raw
    speech-to-text output is not kept."""

    __tablename__ = "dedup_voice_notes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("dedup_items.item_id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    s3_key: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Monlam's service_request for each recording that went into the note
    # ([{"request_id", "model_id"}]), to trace a transcription with Monlam.
    stt_requests: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
