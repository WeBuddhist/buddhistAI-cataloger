"""How many segments a reviewer may add (split off) per document in one review round.

Past the limit the reviewer rejects and sends the work back to the annotator instead of
doing it. Merging is not limited. Admins have no limit. The count starts again once the
annotator fixes a rejected segment (see ``count_reviewer_added_segments_this_round``).
"""
from typing import Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from outliner.repository.segment import (
    count_reviewer_added_segments_this_round,
    get_document_content_length,
)
from user.models.user import User

REVIEWER_SPLIT_LIMIT = 2
# Very long volumes (about 900+ pages, roughly the longest 10%) get more room.
LONG_DOCUMENT_REVIEWER_SPLIT_LIMIT = 4
LONG_DOCUMENT_MIN_CHARS = 1_000_000


def reviewer_split_limit_for_length(content_length: int) -> int:
    if content_length >= LONG_DOCUMENT_MIN_CHARS:
        return LONG_DOCUMENT_REVIEWER_SPLIT_LIMIT
    return REVIEWER_SPLIT_LIMIT


def reviewer_split_usage(db: Session, document_id: str) -> Tuple[int, int]:
    """(segments the reviewer added this round, limit for this document)."""
    used = count_reviewer_added_segments_this_round(db, document_id)
    limit = reviewer_split_limit_for_length(get_document_content_length(db, document_id))
    return used, limit


def assert_reviewer_can_split(db: Session, document_id: str, user: User) -> None:
    if (user.role or "").strip().lower() == "admin":
        return
    used, limit = reviewer_split_usage(db, document_id)
    if used >= limit:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Split limit reached: you have added {used} of {limit} segments allowed in "
                "this document. Reject the segment and send it back to the annotator instead."
            ),
        )
