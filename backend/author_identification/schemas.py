from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Role = Literal["annotator", "reviewer", "admin"]

# A person's role in the text, as BDRC's editions API takes it (GET /editions/roles):
# main author, commentator, tertön, transcriber of teachings, giver of oral teachings, or
# "other" with role_other in the annotator's words.
PERSON_ROLES = ("R0ER0019", "R0ER0014", "R0ER0025", "R0ER0024", "R0ER0032", "other")
MAIN_AUTHOR = "R0ER0019"


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


MAX_PERSONS = 20  # as BDRC's editions API


class PersonIn(BaseModel):
    """One person of the text, in a role: in BDRC (``p_id``) or not (``name_bo``)."""

    model_config = ConfigDict(extra="forbid")

    person_answer: Literal["bdrc", "not_in_bdrc"]
    p_id: str | None = Field(None, pattern=r"^P[A-Za-z0-9_]{1,40}$")
    name_bo: str | None = None
    # BDRC's role code, or "other" with the role in the annotator's words.
    role: Literal[PERSON_ROLES] = MAIN_AUTHOR  # type: ignore[valid-type]
    role_other: str | None = None
    # How sure the annotator is of this person, 1 to 5.
    confidence: int | None = Field(None, ge=1, le=5)
    # The BDRC person's name, to show the answer here without asking BDRC; not sent.
    person_name: str | None = None

    @model_validator(mode="after")
    def _combinations(self) -> "PersonIn":
        if self.person_answer == "bdrc" and _blank(self.p_id):
            raise ValueError("A BDRC person needs its person ID (p_id).")
        if self.person_answer == "bdrc" and not _blank(self.name_bo):
            raise ValueError("name_bo is only given for a person not in BDRC.")
        if self.person_answer == "not_in_bdrc" and (not _blank(self.p_id) or _blank(self.name_bo)):
            raise ValueError("A person not in BDRC has a name (name_bo) and no p_id.")
        if self.role == "other" and _blank(self.role_other):
            raise ValueError('With role "other", say which role (role_other).')
        if self.role != "other" and not _blank(self.role_other):
            raise ValueError('role_other is only given with role "other".')
        return self

    def key(self) -> tuple[str, str]:
        """Who, in which role: the same person may not be twice in one role."""
        who = self.p_id if self.person_answer == "bdrc" else (self.name_bo or "").strip()
        return (who or "", self.role)


class AnswerIn(BaseModel):
    """An answer as the browser sends it: the persons of the text, each in a role ("I don't
    know" or a rejected text have none). Who answered is not part of it: the backend adds the
    logged-in user. The combinations BDRC refuses are refused here too, so a wrong one is told
    to the annotator at once instead of failing later when it is sent."""

    model_config = ConfigDict(extra="forbid")

    # The text the item is about, kept with the answer (BDRC's item has it too).
    edition_id: str | None = Field(None, pattern=r"^[A-Za-z0-9._-]{1,80}$")
    persons: list[PersonIn] = Field(default_factory=list, max_length=MAX_PERSONS)
    # Only "unknown" ("I don't know"), with no persons.
    person_answer: Literal["unknown"] | None = None
    confidence: int | None = Field(None, ge=1, le=5)
    note: str | None = None
    text_rejected: bool = False
    reject_reason: str | None = None
    data: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _combinations(self) -> "AnswerIn":
        if self.person_answer == "unknown" and self.persons:
            raise ValueError('"I don\'t know" comes without persons.')
        if self.text_rejected and _blank(self.reject_reason):
            raise ValueError("A rejected text needs a reason.")
        if not self.text_rejected and not _blank(self.reject_reason):
            raise ValueError("A reason is only given when the text is rejected.")
        if not self.text_rejected and self.person_answer is None and not self.persons:
            raise ValueError("Give at least one person, say you don't know, or reject the text.")
        if any(p.confidence is None for p in self.persons) and self.confidence is None:
            raise ValueError("Say how sure you are (confidence), for each person or for all.")
        keys = [p.key() for p in self.persons]
        if len(set(keys)) != len(keys):
            raise ValueError("The same person is given twice in the same role.")
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
    # The persons as answered (the columns above repeat the first one).
    persons: list[dict]
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


class MyTextOut(BaseModel):
    """One of my texts: who holds it here, and BDRC's item (null if BDRC no longer lists it)."""

    batch_id: str
    item_id: int
    assigned_at: datetime
    completed_at: datetime | None
    item: dict | None
    answer: AnswerOut | None = None


class ClaimOut(BaseModel):
    claimed: int


class ReportedPerson(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^P[A-Za-z0-9_]{1,40}$")
    name: str | None = Field(None, max_length=500)
    dates: str | None = Field(None, max_length=200)


class DuplicateIn(BaseModel):
    """A report that two BDRC persons are one, noticed on a text."""

    model_config = ConfigDict(extra="forbid")

    batch_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,80}$")
    item_id: int = Field(ge=1)
    text_title: str | None = Field(None, max_length=2000)
    person: ReportedPerson
    other: ReportedPerson
    reason: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _two_persons(self) -> "DuplicateIn":
        if self.person.id == self.other.id:
            raise ValueError("Report two different persons.")
        if _blank(self.reason):
            raise ValueError("Say why they are the same person.")
        return self


class DecisionIn(BaseModel):
    """An admin's decision on a report; null opens it again."""

    model_config = ConfigDict(extra="forbid")

    decision: Literal["same", "different"] | None
    note: str = Field("", max_length=4000)


class DuplicateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: str
    item_id: int
    text_title: str | None
    user_id: str
    reporter_name: str | None = None
    person_id: str
    person_name: str | None
    person_dates: str | None
    other_id: str
    other_name: str | None
    other_dates: str | None
    reason: str
    decision: str | None
    decision_note: str | None
    decided_by: str | None
    decided_by_name: str | None = None
    decided_at: datetime | None
    created_at: datetime
    # Reported by the person asking: they may take it back while it is not decided.
    mine: bool = False
