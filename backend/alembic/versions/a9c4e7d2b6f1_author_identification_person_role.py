"""Author Identification: the persons of a text, each in a role

BDRC's editions API takes an answer as a list of persons, each in a role (its role codes, or
"other" with role_other), and does not read a role kept in ``data``, where it was until now.
So:

- add ``persons`` to author_identification_answers;
- fill it for the answers already saved, from their person, its confidence and the role in
  ``data`` (no role = main author);
- send again the current answers whose person is not the main author: BDRC recorded them as
  main author, and sending again replaces the answer there.

Revision ID: a9c4e7d2b6f1
Revises: f3d8b2c6a4e1
Create Date: 2026-11-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9c4e7d2b6f1"
down_revision: Union[str, None] = "f3d8b2c6a4e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The roles the tool kept in data, and BDRC's codes for them.
OLD_ROLES = {"author": "R0ER0019", "terton": "R0ER0025", "scribe": "R0ER0024", "other": "other"}


def upgrade() -> None:
    op.add_column(
        "author_identification_answers",
        sa.Column("persons", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
    )

    # One person per answer until now: from its columns, its name and role in data.
    cases = " ".join(f"WHEN '{old}' THEN '{code}'" for old, code in OLD_ROLES.items())
    op.execute(
        f"""
        UPDATE author_identification_answers
        SET persons = json_build_array(json_strip_nulls(json_build_object(
            'person_answer', person_answer,
            'p_id', CASE WHEN person_answer = 'bdrc' THEN p_id END,
            'name_bo', CASE WHEN person_answer = 'not_in_bdrc' THEN name_bo END,
            'role', CASE (data::jsonb ->> 'role') {cases} ELSE 'R0ER0019' END,
            'role_other', CASE WHEN (data::jsonb ->> 'role') = 'other' THEN data::jsonb ->> 'role_other' END,
            'confidence', confidence,
            'person_name', data::jsonb ->> 'person_name'
        )))
        WHERE person_answer IN ('bdrc', 'not_in_bdrc')
        """
    )

    # The current answer of each text (its newest row), when its person is not the main
    # author and it was already sent or gave up: back in the queue, to be sent with its role.
    op.execute(
        """
        UPDATE author_identification_answers AS a
        SET sync_state = 'pending', sync_attempts = 0, next_attempt_at = NULL, last_error = NULL
        FROM (
            SELECT DISTINCT ON (batch_id, item_id) id
            FROM author_identification_answers
            ORDER BY batch_id, item_id, created_at DESC
        ) AS current
        WHERE a.id = current.id
          AND a.person_answer IN ('bdrc', 'not_in_bdrc')
          AND (a.persons::jsonb -> 0 ->> 'role') <> 'R0ER0019'
          AND a.sync_state IN ('succeeded', 'failed')
        """
    )


def downgrade() -> None:
    op.drop_column("author_identification_answers", "persons")
