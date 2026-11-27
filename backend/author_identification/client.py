"""HTTP client for BDRC's editions API (``/editions``), used by Author Identification.

The API sits behind a password (HTTP basic auth, ``EDITIONS_TOOL_USER`` /
``EDITIONS_TOOL_PASSWORD``). It is only ever sent from here, never to the browser.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from core.config import BEC_OTAPI_BASE_URL, EDITIONS_TOOL_PASSWORD, EDITIONS_TOOL_USER

logger = logging.getLogger(__name__)

_BASE = f"{BEC_OTAPI_BASE_URL.rstrip('/')}/editions"
_TIMEOUT_S = 30.0
# An edition carries its whole text (up to several hundred thousand characters).
_SLOW_TIMEOUT_S = 90.0

# BDRC caps item listing at 500 per request.
MAX_PAGE = 500


class EditionsApiError(Exception):
    """BDRC editions API call failed. ``status_code`` is BDRC's, or None if unreachable
    or not set up."""

    def __init__(self, message: str, status_code: Optional[int] = None, detail: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


def _request(method: str, path: str, *, params: dict | None = None, json: Any = None,
             timeout: float = _TIMEOUT_S) -> Any:
    if not EDITIONS_TOOL_USER or not EDITIONS_TOOL_PASSWORD:
        raise EditionsApiError("EDITIONS_TOOL_USER / EDITIONS_TOOL_PASSWORD are not set")
    url = f"{_BASE}{path}"
    try:
        with httpx.Client(timeout=timeout, auth=(EDITIONS_TOOL_USER, EDITIONS_TOOL_PASSWORD)) as client:
            response = client.request(
                method, url, params=params, json=json, headers={"accept": "application/json"}
            )
    except httpx.HTTPError as exc:
        raise EditionsApiError(f"BDRC editions API unreachable: {exc}") from exc

    if response.status_code >= 400:
        detail: Any = response.text[:500]
        try:
            body = response.json()
            if isinstance(body, dict) and body.get("detail"):
                detail = body["detail"]
        except ValueError:
            pass
        raise EditionsApiError(f"BDRC {method} {path} -> {response.status_code}: {detail}",
                               status_code=response.status_code, detail=detail)
    try:
        return response.json()
    except ValueError as exc:
        raise EditionsApiError(f"BDRC {method} {path} returned non-JSON") from exc


def list_batches() -> list[dict[str, Any]]:
    """Every batch, with its counts per status."""
    return _request("GET", "/batches")


def get_batch(batch_id: str) -> dict[str, Any]:
    """The batch with its counts per status."""
    return _request("GET", f"/batches/{batch_id}")


def list_items(batch_id: str, *, status: str | None = None, text_rejected: bool | None = None,
               offset: int = 0, limit: int = 50) -> dict[str, Any]:
    params: dict[str, Any] = {"offset": offset, "limit": min(limit, MAX_PAGE)}
    if status:
        params["status"] = status
    if text_rejected is not None:
        params["text_rejected"] = "true" if text_rejected else "false"
    return _request("GET", f"/batches/{batch_id}/items", params=params)


def get_item(batch_id: str, item_id: int) -> dict[str, Any]:
    return _request("GET", f"/batches/{batch_id}/items/{item_id}")


def get_edition(edition_id: str) -> dict[str, Any]:
    """The edition with its text, versions and author suggestions."""
    return _request("GET", f"/{edition_id}", timeout=_SLOW_TIMEOUT_S)


def put_answer(batch_id: str, item_id: int, answer: dict[str, Any]) -> dict[str, Any]:
    """Send the answer; sending again replaces it (BDRC keeps the history)."""
    return _request("PUT", f"/batches/{batch_id}/items/{item_id}", json=answer)
