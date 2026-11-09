"""Spoken notes: transcribe a recording, then keep the audio in S3 when the note is saved.

Flow: the browser sends each recording to ``transcribe`` (nothing stored) and puts the
text in the note box. When the user saves the note, the browser sends the recording to
``save`` (S3 + a ``dedup_voice_notes`` row) and stores the returned id on the note. The
note's text, as corrected, travels in the decision's ``partner_payload.notes``.
"""
from __future__ import annotations

import io
import logging
import uuid
import wave
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from dedup import storage, stt
from dedup.deps import can_adjudicate
from dedup.models.dedup import DedupVoiceNote
from dedup.repository import dedup_repository as repo
from user.models.user import User

logger = logging.getLogger(__name__)

MAX_BYTES = 25 * 1024 * 1024  # ~13 min of 16 kHz mono WAV


def check_size(audio: bytes) -> None:
    if not audio:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(audio) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The recording is too long.")


def transcribe(audio: bytes, filename: str, content_type: str) -> dict[str, Any]:
    check_size(audio)
    try:
        result = stt.transcribe(audio, filename, content_type)
    except stt.SttError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"text": result.text, "request_id": result.request_id, "model_id": result.model_id}


def _may_write_notes(db: Session, user: User, item_id: int) -> None:
    """Those who can write notes on a pair: its annotators, adjudicators and admins."""
    if repo.get_item(db, item_id) is None:
        raise HTTPException(status_code=404, detail=f"Item {item_id} not found")
    if repo.get_assignment(db, item_id, user.id) is None and not can_adjudicate(user):
        raise HTTPException(status_code=403, detail="You cannot add notes to this pair")


def _wav_seconds(audio: bytes) -> float | None:
    try:
        with wave.open(io.BytesIO(audio)) as w:
            return round(w.getnframes() / float(w.getframerate()), 2)
    except (wave.Error, EOFError, ZeroDivisionError):
        return None


def save(
    db: Session, user: User, item_id: int, audio: bytes, content_type: str, stt_requests: list[dict[str, Any]]
) -> dict[str, str]:
    check_size(audio)
    _may_write_notes(db, user, item_id)
    note_id = str(uuid.uuid4())
    key = storage.key_for(item_id, note_id)
    try:
        storage.upload(key, audio, content_type)
    except storage.StorageError as exc:
        logger.error("Voice note upload failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not store the recording.") from exc
    db.add(DedupVoiceNote(
        id=note_id,
        item_id=item_id,
        user_id=user.id,
        s3_key=key,
        content_type=content_type,
        size_bytes=len(audio),
        duration_s=_wav_seconds(audio),
        stt_requests=stt_requests or None,
    ))
    db.commit()
    return {"id": note_id}


def playback_url(db: Session, voice_note_id: str) -> dict[str, str]:
    row = db.get(DedupVoiceNote, voice_note_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    try:
        return {"url": storage.playback_url(row.s3_key)}
    except storage.StorageError as exc:
        logger.error("Voice note link failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not load the recording.") from exc
