"""Author Identification duplicate reports

author_identification_duplicate_reports: two BDRC persons reported as one, noticed on a
text, with an admin's decision later. Until now reports stayed in the reporter's browser.

Revision ID: b5d2f8a1c3e7
Revises: a9c4e7d2b6f1
Create Date: 2026-11-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b5d2f8a1c3e7"
down_revision: Union[str, None] = "a9c4e7d2b6f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "author_identification_duplicate_reports",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("text_title", sa.Text(), nullable=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("person_id", sa.String(), nullable=False),
        sa.Column("person_name", sa.Text(), nullable=True),
        sa.Column("person_dates", sa.Text(), nullable=True),
        sa.Column("other_id", sa.String(), nullable=False),
        sa.Column("other_name", sa.Text(), nullable=True),
        sa.Column("other_dates", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("decision", sa.String(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("decided_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_author_identification_duplicates_item", "author_identification_duplicate_reports", ["batch_id", "item_id"]
    )
    op.create_index(
        "ix_author_identification_duplicate_reports_user_id", "author_identification_duplicate_reports", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_author_identification_duplicate_reports_user_id", table_name="author_identification_duplicate_reports")
    op.drop_index("ix_author_identification_duplicates_item", table_name="author_identification_duplicate_reports")
    op.drop_table("author_identification_duplicate_reports")
