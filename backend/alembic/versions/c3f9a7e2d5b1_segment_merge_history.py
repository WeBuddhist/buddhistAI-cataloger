"""outliner segment merge history: lets a reviewer's merge be undone

- outliner_segments.merge_history: what each reviewer merge removed from this segment (split
  position, the removed segment's fields and who made it), so the annotator's segment and
  credit come back on "Undo merge" or a re-split at the same spot.

Revision ID: c3f9a7e2d5b1
Revises: d9a1f3c5e7b2
Create Date: 2026-11-20

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3f9a7e2d5b1"
down_revision: Union[str, None] = "d9a1f3c5e7b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("outliner_segments", sa.Column("merge_history", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("outliner_segments", "merge_history")
