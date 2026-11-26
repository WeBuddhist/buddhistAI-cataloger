"""Background worker that sends saved Author Identification answers to BDRC.

An answer waiting to be sent is a row (``sync_state = pending``), so a send interrupted by
a crash, deploy or restart is retried on the next poll rather than lost. As
``dedup.sync_worker``.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

from author_identification import client
from author_identification import repository as repo
from author_identification.client import EditionsApiError
from author_identification.models import AuthorAnswer
from core.config import AUTHOR_IDENTIFICATION_SYNC_ENABLED
from core.database import SessionLocal

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 10
# How often to reclaim answers abandoned by a restart.
STALE_SWEEP_INTERVAL_SECONDS = 300

_worker_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def bdrc_body(a: AuthorAnswer) -> dict[str, Any]:
    """The answer as BDRC's PUT /editions/batches/{batch}/items/{item} takes it."""
    return {
        "annotator_id": a.user_id,
        "person_answer": a.person_answer,
        "p_id": a.p_id,
        "name_bo": a.name_bo,
        "confidence": a.confidence,
        "note": a.note,
        "text_rejected": a.text_rejected,
        "reject_reason": a.reject_reason,
        "data": a.data or {},
        # When the person answered, not when it reached BDRC.
        "decided_at": a.decided_at.isoformat() + "Z",
    }


def _retriable(exc: Exception) -> bool:
    """BDRC unreachable, busy, failing on its side, or refusing our login (fixed by
    setting the password): worth trying again later. Not set up here: same."""
    if not isinstance(exc, EditionsApiError):
        return False
    s = exc.status_code
    return s is None or s >= 500 or s in (401, 403, 429)


def _process_available() -> int:
    """Send every answer now due. Returns how many were attempted."""
    processed = 0
    while not _stop_event.is_set():
        db = SessionLocal()
        try:
            answer = repo.claim_next_answer(db)
            if answer is None:
                return processed
            processed += 1
            try:
                client.put_answer(answer.batch_id, answer.item_id, bdrc_body(answer))
                repo.mark_synced(db, answer.id)
                logger.info(
                    "author identification sync ok answer=%s batch=%s item=%s attempts=%s",
                    answer.id, answer.batch_id, answer.item_id, answer.sync_attempts,
                )
            except Exception as exc:  # any failure must be recorded
                db.rollback()
                repo.mark_sync_failed(db, answer.id, f"{type(exc).__name__}: {exc}", retriable=_retriable(exc))
                logger.warning(
                    "author identification sync failed answer=%s batch=%s item=%s attempts=%s error=%s",
                    answer.id, answer.batch_id, answer.item_id, answer.sync_attempts, exc,
                )
        finally:
            db.close()
    return processed


def _worker_loop() -> None:
    last_sweep = 0.0
    while not _stop_event.is_set():
        try:
            now = time.monotonic()
            if now - last_sweep > STALE_SWEEP_INTERVAL_SECONDS:
                last_sweep = now
                db = SessionLocal()
                try:
                    requeued = repo.requeue_stale_running(db)
                    if requeued:
                        logger.warning("author identification sync requeued %s stale answer(s)", requeued)
                finally:
                    db.close()
            _process_available()
        except Exception:  # the loop must outlive any single failure
            logger.exception("author identification sync worker loop error")
        _stop_event.wait(POLL_INTERVAL_SECONDS)


def start_worker() -> None:
    """Start the worker (once, from app startup); not with AUTHOR_IDENTIFICATION_SYNC=off."""
    global _worker_thread
    if not AUTHOR_IDENTIFICATION_SYNC_ENABLED:
        logger.warning(
            "author identification sync to BDRC is off (AUTHOR_IDENTIFICATION_SYNC=off): answers stay queued here"
        )
        return
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    _stop_event.clear()
    _worker_thread = threading.Thread(target=_worker_loop, name="author-identification-sync-worker", daemon=True)
    _worker_thread.start()
    logger.info("author identification sync worker started (poll=%ss)", POLL_INTERVAL_SECONDS)


def stop_worker(timeout: float = 5.0) -> None:
    """Signal the worker to stop; an answer being sent is requeued by the stale sweep."""
    _stop_event.set()
    if _worker_thread is not None:
        _worker_thread.join(timeout=timeout)
