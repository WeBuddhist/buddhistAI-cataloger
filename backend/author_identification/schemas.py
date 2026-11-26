from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


def _blank(s: str | None) -> bool:
    return s is None or not s.strip()


class AnswerIn(BaseModel):
    """An answer as the browser sends it. Who answered is not part of it: the backend adds
    the logged-in user. The combinations BDRC refuses are refused here too, so a wrong one
    is told to the annotator at once instead of failing later when it is sent."""

    model_config = ConfigDict(extra="forbid")

    # The text the item is about, kept with the answer (BDRC's item has it too).
    edition_id: str | None = Field(None, pattern=r"^[A-Za-z0-9._-]{1,80}$")
    person_answer: Literal["bdrc", "not_in_bdrc", "unknown"] | None = None
    p_id: str | None = Field(None, pattern=r"^P[A-Za-z0-9_]{1,40}$")
    name_bo: str | None = None
    confidence: int | None = Field(None, ge=1, le=5)
    note: str | None = None
    text_rejected: bool = False
    reject_reason: str | None = None
    data: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _combinations(self) -> "AnswerIn":
        if self.person_answer == "bdrc" and _blank(self.p_id):
            raise ValueError("A BDRC person needs its person ID (p_id).")
        if self.text_rejected and _blank(self.reject_reason):
            raise ValueError("A rejected text needs a reason.")
        if not self.text_rejected and not _blank(self.reject_reason):
            raise ValueError("A reason is only given when the text is rejected.")
        if not self.text_rejected and self.person_answer is None:
            raise ValueError("Give an answer, or reject the text with a reason.")
        return self


class AnswerOut(BaseModel):
    """An answer as saved here, with how far it is on its way to BDRC."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: str
    item_id: int
    edition_id: str | None
    user_id: str
    role: str
    person_answer: str | None
    p_id: str | None
    name_bo: str | None
    confidence: int | None
    note: str | None
    text_rejected: bool
    reject_reason: str | None
    data: dict
    decided_at: datetime
    # pending (waiting to be sent) / running / succeeded (BDRC has it) / failed (BDRC
    # refused it; see last_error) / superseded (a newer answer replaced it before sending)
    sync_state: str
    sync_attempts: int
    last_error: str | None
    synced_at: datetime | None


class ActiveTimeIn(BaseModel):
    # One visit's active time; a long idle tab is not counted by the browser.
    seconds: int = Field(ge=1, le=6 * 3600)


class SyncHealthOut(BaseModel):
    counts: dict[str, int]
    failed: list[AnswerOut]
