"""Auth and authorization dependencies for outliner HTTP routes."""

from __future__ import annotations

import json
from collections.abc import Sequence

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func

from core.auth0_access_token import email_from_access_token_claims, verify_auth0_access_token
from core.database import SessionLocal
from user.models.user import User

OUTLINER_PERMISSION = "outliner"
_ALLOWED_OUTLINER_ROLES = frozenset({"admin", "reviewer", "annotator"})
_outliner_bearer = HTTPBearer(auto_error=False)


def _parse_permissions(permissions_raw: str | None) -> list[str]:
    if not permissions_raw:
        return []
    try:
        parsed = json.loads(permissions_raw)
        return [p.strip() for p in parsed] if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return [p.strip() for p in permissions_raw.split(",") if p.strip()]


def require_outliner_access(
    creds: HTTPAuthorizationCredentials | None = Depends(_outliner_bearer),
) -> User:
    """Validate Auth0 access token (Bearer) and ensure the user may use outliner APIs.

    Uses a short-lived session so auth does not hold a pool connection for the
    rest of the request (important for long handlers like ai-outline).
    """
    if (
        not creds
        or creds.scheme.lower() != "bearer"
        or not (creds.credentials or "").strip()
    ):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization bearer token",
        )
    payload = verify_auth0_access_token(creds.credentials.strip())
    email = email_from_access_token_claims(payload)
    if not email:
        raise HTTPException(
            status_code=401,
            detail="Token is missing an email claim (add email to the access token via an Auth0 Action if needed)",
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter(func.lower(User.email) == email).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        perms = _parse_permissions(user.permissions)
        if OUTLINER_PERMISSION not in perms:
            raise HTTPException(status_code=403, detail="Unauthorized")

        role = (user.role or "user").strip().lower()
        if role not in _ALLOWED_OUTLINER_ROLES:
            raise HTTPException(status_code=403, detail="Unauthorized")

        db.expunge(user)
        return user
    finally:
        db.close()


def require_outliner_admin(user: User = Depends(require_outliner_access)) -> User:
    if (user.role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return user



def is_user_admin_or_reviewer(user: User) -> bool:
    """Only reviewer/admin attribution updates reviewed_by_id on segments."""
    role = (user.role or "user").strip().lower()
    return role in ("reviewer", "admin")


def can_user_reject_segment(
    user: User,
    document_owner_ids: Sequence[str | None],
) -> None:
    """Rejections require reviewer or admin; document owners cannot reject their own work."""
    if not is_user_admin_or_reviewer(user):
        raise HTTPException(
            status_code=403,
            detail="Only reviewers and administrators can reject segments",
        )
    for owner_id in document_owner_ids:
        if owner_id is not None and owner_id == user.id:
            raise HTTPException(
                status_code=403,
                detail="You cannot reject segments on your own documents",
            )


def apply_authenticated_segment_reviewer(
    patch: dict,
    user: User,
    *,
    document_owner_id: str | None = None,
) -> None:
    """Strip client reviewer_id; set from token only for reviewer/admin when status is checked/approved.

    When ``document_owner_id`` is the same as ``user.id``, do not inject reviewer attribution so users
    cannot record themselves as reviewer on their own documents.
    """
    patch.pop("reviewer_id", None)
    if document_owner_id is not None and document_owner_id == user.id:
        return
    if patch.get("status") in ("checked", "approved") and is_user_admin_or_reviewer(user):
        patch["reviewer_id"] = user.id


def assert_assigned_document_participant(
    document_owner_id: str | None,
    document_reviewer_id: str | None,
    user: User,
) -> None:
    """Mutations allowed for the assigned annotator (``user_id``) or reviewer."""
    uid = user.id
    if (document_owner_id is not None and document_owner_id == uid) or (
        document_reviewer_id is not None and document_reviewer_id == uid
    ):
        return
    raise HTTPException(
        status_code=403,
        detail="Only the assigned annotator or reviewer can modify this document",
    )


def assert_assigned_document_reviewer(
    document_reviewer_id: str | None,
    user: User,
) -> None:
    """Reviewer-only mutations require ``outliner_documents.reviewer_id`` to match the caller."""
    if document_reviewer_id is None or document_reviewer_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the assigned reviewer can perform this action",
        )


def assert_document_editable(
    document_status: str | None,
    document_reviewer_id: str | None,
    user: User,
    *,
    has_rejected_segment: bool = False,
) -> None:
    """Approved documents are view-only for the annotator.

    The assigned reviewer and admins may still change them, as they could before the
    annotator was allowed to open approved documents. If the reviewer has sent a segment
    back (a rejected segment in an approved document), the annotator may fix it as before.
    """
    if (document_status or "").strip().lower() != "approved":
        return
    if has_rejected_segment:
        return
    if (user.role or "").strip().lower() == "admin":
        return
    if document_reviewer_id is not None and document_reviewer_id == user.id:
        return
    raise HTTPException(
        status_code=403,
        detail="This document is approved and is view-only",
    )


def assert_assigned_document_annotator(
    document_owner_id: str | None,
    user: User,
) -> None:
    """Annotator-only mutations require ``outliner_documents.user_id`` to match the caller."""
    if document_owner_id is None or document_owner_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the assigned annotator can perform this action",
        )


def enforce_segment_review_patch_authorization(
    patch: dict,
    user: User,
    *,
    document_owner_id: str | None,
    document_reviewer_id: str | None,
) -> None:
    """Block reviewer workflow fields unless the caller is the assigned reviewer."""
    if document_owner_id is not None and document_owner_id == user.id:
        return

    review_keys = {"reviewer_title", "reviewer_author"}
    if patch.keys() & review_keys:
        assert_assigned_document_reviewer(document_reviewer_id, user)

    segment_keys = {
        "status",
        "title",
        "author",
        "title_bdrc_id",
        "author_bdrc_id",
        "is_supplied_title",
        "label",
    }
    if patch.keys() & segment_keys:
        assert_assigned_document_participant(
            document_owner_id, document_reviewer_id, user
        )


def apply_authenticated_segment_reviewer_bulk(
    updates: list[dict] | None,
    user: User,
    *,
    document_owner_id: str | None = None,
) -> None:
    if not updates:
        return
    for row in updates:
        apply_authenticated_segment_reviewer(row, user, document_owner_id=document_owner_id)
