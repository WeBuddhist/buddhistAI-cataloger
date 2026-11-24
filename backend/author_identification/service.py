"""Author Identification's users: who can use it, and their role in it."""
from __future__ import annotations

import json

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from author_identification.deps import (
    AUTHOR_IDENTIFICATION_PERMISSION,
    author_identification_role,
    has_author_identification_access,
)
from author_identification.schemas import MemberOut, MemberPageOut, MemberUpdateIn
from core.redis import invalidate_user_by_email_cache
from dedup.deps import _parse_permissions
from user.models.user import User


def _member(user: User) -> MemberOut:
    return MemberOut(
        id=user.id,
        name=user.name,
        email=user.email,
        picture=user.picture,
        created_at=user.created_at,
        access=has_author_identification_access(user),
        role=author_identification_role(user),
    )


def list_members(db: Session, q: str | None, role: str | None, page: int, page_size: int) -> MemberPageOut:
    """Every Cataloger account, newest first. ``role``: admin / reviewer / annotator (all
    imply access) or none (no access)."""
    query = db.query(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(User.name.ilike(like), User.email.ilike(like)))
    has_permission = User.permissions.contains(AUTHOR_IDENTIFICATION_PERMISSION, autoescape=True)
    role_column = User.author_identification_role
    if role in ("admin", "reviewer"):
        query = query.filter(has_permission, role_column == role)
    elif role == "annotator":
        query = query.filter(
            has_permission, or_(role_column.is_(None), role_column.notin_(("admin", "reviewer")))
        )
    elif role == "none":
        query = query.filter(or_(User.permissions.is_(None), ~has_permission))
    rows = (
        query.order_by(User.created_at.desc().nullslast(), User.email)
        .offset((page - 1) * page_size)
        .limit(page_size + 1)
        .all()
    )
    return MemberPageOut(users=[_member(u) for u in rows[:page_size]], has_next=len(rows) > page_size)


def update_member(db: Session, user_id: str, body: MemberUpdateIn, admin: User) -> MemberOut:
    """Author Identification access and role only; the user's other permissions and roles
    stay."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id and (body.access is False or body.role not in (None, "admin")):
        raise HTTPException(status_code=409, detail="You can't remove your own admin access")
    if body.access is not None:
        permissions = [p for p in _parse_permissions(user.permissions) if p != AUTHOR_IDENTIFICATION_PERMISSION]
        if body.access:
            permissions.append(AUTHOR_IDENTIFICATION_PERMISSION)
        user.permissions = json.dumps(permissions) if permissions else None
    if body.role is not None:
        user.author_identification_role = None if body.role == "annotator" else body.role
    db.commit()
    db.refresh(user)
    # /settings/users/me is cached by email and carries the permissions.
    invalidate_user_by_email_cache(user.email)
    return _member(user)
