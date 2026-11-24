"""HTTP routes for Author Identification, mounted at ``/author-identification``.

Only access and users so far. Texts and answers come with BDRC's endpoints; their routes
should depend on ``require_author_identification_access``. Plain ``def`` routes: the DB
calls are synchronous.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from author_identification import service
from author_identification.deps import (
    author_identification_role,
    has_author_identification_access,
    require_author_identification_admin,
    require_logged_in,
)
from author_identification.schemas import MemberOut, MemberPageOut, MemberUpdateIn, MeOut
from core.database import get_db
from user.models.user import User

router = APIRouter()


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(require_logged_in)):
    """My Author Identification access and role, for the nav and the admin pages."""
    return MeOut(access=has_author_identification_access(user), role=author_identification_role(user))


@router.get(
    "/admin/users",
    response_model=MemberPageOut,
    dependencies=[Depends(require_author_identification_admin)],
)
def list_members(
    q: str | None = None,
    role: str | None = Query(None, pattern="^(admin|reviewer|annotator|none)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Every Cataloger account with its access and role here, for the Users page."""
    return service.list_members(db, q, role, page, page_size)


@router.patch("/admin/users/{user_id}", response_model=MemberOut)
def update_member(
    user_id: str,
    body: MemberUpdateIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_author_identification_admin),
):
    """Give or take access, or change the role here. Nothing else about the account
    changes."""
    return service.update_member(db, user_id, body, admin)
