"""Author Identification assignments

author_identification_assignments: which person each text of a batch was handed to
("Assign work", 5 at a time). One person per text; finished when they save an answer.

Revision ID: f3d8b2c6a4e1
Revises: e7c1a9b3d5f2
Create Date: 2026-11-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3d8b2c6a4e1"
down_revision: Union[str, None] = "e7c1a9b3d5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "author_identification_assignments",
        sa.Column("batch_id", sa.String(), primary_key=True),
        sa.Column("item_id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("edition_id", sa.String(), nullable=True),
        sa.Column("assigned_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_author_identification_assignments_user_id", "author_identification_assignments", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_author_identification_assignments_user_id", table_name="author_identification_assignments")
    op.drop_table("author_identification_assignments")
