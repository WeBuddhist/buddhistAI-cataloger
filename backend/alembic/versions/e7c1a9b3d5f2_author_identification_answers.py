"""Author Identification answers and active time

author_identification_answers: every answer saved in the tool, append-only, with its
state of sending to BDRC's editions API (the latest answer of each text is sent).
author_identification_active_time: seconds each person spent on each text.

Revision ID: e7c1a9b3d5f2
Revises: d4b8e2f6a1c9
Create Date: 2026-11-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7c1a9b3d5f2"
down_revision: Union[str, None] = "d4b8e2f6a1c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "author_identification_answers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("edition_id", sa.String(), nullable=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="annotator"),
        sa.Column("person_answer", sa.String(), nullable=True),
        sa.Column("p_id", sa.String(), nullable=True),
        sa.Column("name_bo", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("text_rejected", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("reject_reason", sa.Text(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=False),
        sa.Column("sync_state", sa.String(), nullable=False),
        sa.Column("sync_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_author_identification_answers_item", "author_identification_answers", ["batch_id", "item_id"])
    op.create_index("ix_author_identification_answers_user_id", "author_identification_answers", ["user_id"])
    op.create_index("ix_author_identification_answers_sync_state", "author_identification_answers", ["sync_state"])

    op.create_table(
        "author_identification_active_time",
        sa.Column("batch_id", sa.String(), primary_key=True),
        sa.Column("item_id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_author_identification_active_time_user_id", "author_identification_active_time", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_author_identification_active_time_user_id", table_name="author_identification_active_time")
    op.drop_table("author_identification_active_time")
    op.drop_index("ix_author_identification_answers_sync_state", table_name="author_identification_answers")
    op.drop_index("ix_author_identification_answers_user_id", table_name="author_identification_answers")
    op.drop_index("ix_author_identification_answers_item", table_name="author_identification_answers")
    op.drop_table("author_identification_answers")
