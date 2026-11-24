"""Auth dependencies for Author Identification.

Access is the ``author_identification`` permission; the user's part here (annotator /
reviewer / admin) is ``users.author_identification_role``. The other tools' roles play no
part, admin included.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from dedup.deps import _bearer, _parse_permissions, _user_from_token
from user.models.user import User

AUTHOR_IDENTIFICATION_PERMISSION = "author_identification"
# Reviewers check the answers; until there are answers to review, they have what
# annotators have.
AUTHOR_IDENTIFICATION_ROLES = ("annotator", "reviewer", "admin")


def has_author_identification_access(user: User) -> bool:
    return AUTHOR_IDENTIFICATION_PERMISSION in _parse_permissions(user.permissions)


def author_identification_role(user: User) -> str:
    """"annotator", "reviewer" or "admin"; NULL or anything else = annotator."""
    role = (user.author_identification_role or "").strip().lower()
    return role if role in AUTHOR_IDENTIFICATION_ROLES else "annotator"


def is_author_identification_admin(user: User) -> bool:
    return has_author_identification_access(user) and author_identification_role(user) == "admin"


def require_logged_in(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    return _user_from_token(creds)


def require_author_identification_access(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    user = _user_from_token(creds)
    if not has_author_identification_access(user):
        raise HTTPException(status_code=403, detail="No access to Author Identification")
    return user


def require_author_identification_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    user = _user_from_token(creds)
    if not is_author_identification_admin(user):
        raise HTTPException(status_code=403, detail="Admins only")
    return user
