"""Monlam AI speech-to-text for voice notes.

Uses ``POST /api/v1/speech-to-text/live`` ("STT v4 Live" on Monlam's site): the most
even across Ü-Tsang, Amdo and Kham in Monlam's published error rates. ``/api/v1`` is
Monlam's API version, not the model version.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

from core.config import MONLAM_API_BASE_URL, MONLAM_API_KEY

logger = logging.getLogger(__name__)

_URL = f"{MONLAM_API_BASE_URL}/api/v1/speech-to-text/live"
_TIMEOUT_S = 120.0
# Cloudflare in front of the API rejects default library User-Agents (error 1010).
_USER_AGENT = "buddhistai-cataloger/1.0"


class SttError(Exception):
    """Transcription failed. ``status_code`` is the HTTP status to answer with."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


_TEXT_KEYS = ("text", "transcript", "transcription")


def _text_of(body: Any) -> str | None:
    """The transcript in Monlam's response (under ``response_payload``; the field name
    is not in their spec, so any nesting is searched)."""
    if isinstance(body, dict):
        for key in _TEXT_KEYS:
            if isinstance(body.get(key), str):
                return body[key]
        values = [body[k] for k in ("response_payload", "result", "data", "output") if k in body]
        values += [v for k, v in body.items() if k not in ("response_payload", "result", "data", "output")]
        for value in values:
            found = _text_of(value)
            if found is not None:
                return found
    elif isinstance(body, list):
        parts = [t for t in (_text_of(v) for v in body) if t]
        return " ".join(parts) if parts else None
    return None


# Monlam's two answer shapes (both HTTP 200):
#   success: flat  {"text", "status": "success", "service_request_id", "model", "cost", ...}
#   failure: nested {"service_request": {"status": "failed", "id", "model_id", ...},
#                    "response_payload": null}
def _service_request(body: Any) -> dict[str, Any]:
    request = body.get("service_request") if isinstance(body, dict) else None
    return request if isinstance(request, dict) else {}


def _failed(body: Any) -> bool:
    """Monlam could not transcribe (e.g. no speech heard), though the HTTP status is 200."""
    status = _service_request(body).get("status") or (body.get("status") if isinstance(body, dict) else None)
    return str(status or "").lower() == "failed"


@dataclass
class Transcript:
    text: str
    # Monlam's request id and model, to trace the transcription with Monlam.
    request_id: str | None
    model_id: str | None


def transcribe(audio: bytes, filename: str, content_type: str) -> Transcript:
    if not MONLAM_API_KEY:
        raise SttError("Voice notes are not set up: MONLAM_API_KEY is missing on the server.", 503)
    try:
        with httpx.Client(timeout=_TIMEOUT_S) as client:
            response = client.post(
                _URL,
                headers={
                    "X-API-Key": MONLAM_API_KEY,
                    "x-idempotency-key": str(uuid.uuid4()),
                    "User-Agent": _USER_AGENT,
                    "accept": "application/json",
                },
                files={"file": (filename, audio, content_type)},
                data={"language": "bo"},
            )
    except httpx.HTTPError as exc:
        raise SttError(f"Speech-to-text service unreachable: {exc}") from exc

    if response.status_code >= 400:
        logger.warning("Monlam STT %s: %s", response.status_code, response.text[:500])
        raise SttError(f"Speech-to-text failed ({response.status_code}).")
    try:
        body = response.json()
    except ValueError as exc:
        raise SttError("Speech-to-text returned a non-JSON answer.") from exc

    if _failed(body):
        logger.info("Monlam STT failed: %s", str(body)[:500])
        raise SttError("Could not turn the recording into text. Speak closer to the microphone and try again.", 422)
    text = _text_of(body)
    if text is None:
        logger.warning("Monlam STT: no transcript field in %s", str(body)[:500])
        raise SttError("Speech-to-text answer had no transcript in it.")
    nested = _service_request(body)
    return Transcript(
        text=text.strip(),
        request_id=body.get("service_request_id") or nested.get("id"),
        model_id=body.get("model") or nested.get("model_id"),
    )
