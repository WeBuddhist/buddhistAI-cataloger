from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Role = Literal["annotator", "reviewer", "admin"]


class MeOut(BaseModel):
    access: bool
    role: Role


class MemberOut(BaseModel):
    """A Cataloger account as Author Identification's Users page shows it."""

    id: str
    name: str | None
    email: str
    picture: str | None
    created_at: datetime | None
    access: bool
    role: Role


class MemberPageOut(BaseModel):
    users: list[MemberOut]
    has_next: bool


class MemberUpdateIn(BaseModel):
    # Either or both; a field left out is not changed.
    access: bool | None = None
    role: Role | None = None
