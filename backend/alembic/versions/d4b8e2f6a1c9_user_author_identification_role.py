"""separate Author Identification role per user

users.author_identification_role: the user's role in Author Identification, apart from
users.role (the Outliner's) and the other tools' roles. "annotator", "reviewer" or "admin";
NULL means annotator. Access itself is the author_identification permission.

Backfill gives the tool its first admins, who let everyone else in from its Users page:
today's Outline Fixer admins (users.outline_fix_role with the outline_fix permission). Not
the Outliner's admins, of whom there are many.

Revision ID: d4b8e2f6a1c9
Revises: c3f9a7e2d5b1
Create Date: 2026-11-24

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4b8e2f6a1c9"
down_revision: Union[str, None] = "c3f9a7e2d5b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERMISSION = "author_identification"

users = sa.table(
    "users",
    sa.column("id", sa.String),
    sa.column("email", sa.String),
    sa.column("permissions", sa.String),
    sa.column("outline_fix_role", sa.String),
    sa.column("author_identification_role", sa.String),
)


def _permissions(raw: str | None) -> list[str]:
    """As dedup.deps._parse_permissions: a JSON list, or comma-separated in old rows."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [p.strip() for p in parsed] if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return [p.strip() for p in raw.split(",") if p.strip()]


def _forget_cached(emails: list[str]) -> None:
    """User records are cached by email for days and carry the permissions."""
    try:
        from core.redis import invalidate_user_by_email_cache

        for email in emails:
            invalidate_user_by_email_cache(email)
    except Exception as e:  # The cache must not stop a migration.
        print(f"Could not clear cached users: {e}")


def upgrade() -> None:
    op.add_column("users", sa.Column("author_identification_role", sa.String(), nullable=True))
    conn = op.get_bind()
    admins = conn.execute(
        sa.select(users.c.id, users.c.email, users.c.permissions).where(users.c.outline_fix_role == "admin")
    ).all()
    changed = []
    for user_id, email, raw in admins:
        permissions = _permissions(raw)
        if "outline_fix" not in permissions:
            continue
        if PERMISSION not in permissions:
            permissions.append(PERMISSION)
        conn.execute(
            users.update()
            .where(users.c.id == user_id)
            .values(author_identification_role="admin", permissions=json.dumps(permissions))
        )
        changed.append(email)
    _forget_cached(changed)


def downgrade() -> None:
    conn = op.get_bind()
    changed = []
    for user_id, email, raw in conn.execute(
        sa.select(users.c.id, users.c.email, users.c.permissions).where(users.c.permissions.contains(PERMISSION))
    ).all():
        permissions = [p for p in _permissions(raw) if p != PERMISSION]
        conn.execute(
            users.update()
            .where(users.c.id == user_id)
            .values(permissions=json.dumps(permissions) if permissions else None)
        )
        changed.append(email)
    op.drop_column("users", "author_identification_role")
    _forget_cached(changed)
