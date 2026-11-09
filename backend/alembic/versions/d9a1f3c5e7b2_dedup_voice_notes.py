"""dedup voice notes: the S3 recording behind a spoken note

``dedup_voice_notes`` points at the audio in S3; the note's corrected text stays in the
decision's ``partner_payload.notes`` (which references these rows by ``voice_note_ids``).

Revision ID: d9a1f3c5e7b2
Revises: b8d4f0a2c3e5
Create Date: 2026-11-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d9a1f3c5e7b2"
down_revision: Union[str, None] = "b8d4f0a2c3e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dedup_voice_notes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("dedup_items.item_id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("s3_key", sa.String(), nullable=False, unique=True),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("stt_requests", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_dedup_voice_notes_item_id", "dedup_voice_notes", ["item_id"])
    op.create_index("ix_dedup_voice_notes_user_id", "dedup_voice_notes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_dedup_voice_notes_user_id", table_name="dedup_voice_notes")
    op.drop_index("ix_dedup_voice_notes_item_id", table_name="dedup_voice_notes")
    op.drop_table("dedup_voice_notes")
