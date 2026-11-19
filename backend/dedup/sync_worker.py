"""Background worker that pushes pending dedup decisions to BDRC.

The intent to sync is a row, so a push interrupted by a crash, deploy or restart is
retried on the next poll rather than lost.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from core.config import DEDUP_SYNC_ENABLED
from core.database import SessionLocal
from dedup import client
from dedup.client import ReviewApiError
from dedup.controller.dedup import bdrc_payload, merged_with_bdrc
from dedup.repository import dedup_repository as repo

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 10
# How often to reclaim decisions abandoned by a restart.
STALE_SWEEP_INTERVAL_SECONDS = 300

_worker_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def _retriable(exc: Exception) -> bool:
    """BDRC unreachable, busy or failing on its side: worth trying again later."""
    if not isinstance(exc, ReviewApiError):
        return False
    return exc.status_code is None or exc.status_code >= 500 or exc.status_code == 429


def _process_available() -> int:
    """Push every currently-due decision. Returns how many were attempted."""
    processed = 0
    while not _stop_event.is_set():
        db = SessionLocal()
        try:
            decision = repo.claim_next_decision(db)
            if decision is None:
                return processed
            processed += 1
            try:
                # BDRC replaces issues and partner_payload whole, and adds its own flags and
                # markers to them: what it holds now is read first and kept. If it cannot
                # be read, nothing is sent; the decision is retried.
                current = client.get_item(decision.item_id)
                previous = repo.last_sent_decision(db, decision.item_id, before=decision)
                last_sent = bdrc_payload(db, previous) if previous else None
                body = merged_with_bdrc(bdrc_payload(db, decision), current, last_sent)
                client.put_item(decision.item_id, body)
                repo.mark_synced(db, decision.id)
                logger.info(
                    "dedup sync ok decision=%s item=%s attempts=%s",
                    decision.id, decision.item_id, decision.sync_attempts,
                )
            except Exception as exc:  # any failure must schedule a retry
                db.rollback()
                repo.mark_sync_failed(db, decision.id, f"{type(exc).__name__}: {exc}", retriable=_retriable(exc))
                logger.warning(
                    "dedup sync failed decision=%s item=%s attempts=%s error=%s",
                    decision.id, decision.item_id, decision.sync_attempts, exc,
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
                        logger.warning("dedup sync requeued %s stale decision(s)", requeued)
                finally:
                    db.close()
            _process_available()
        except Exception:  # the loop must outlive any single failure
            logger.exception("dedup sync worker loop error")
        _stop_event.wait(POLL_INTERVAL_SECONDS)


def start_worker() -> None:
    """Start the worker (called once from app startup); not with DEDUP_SYNC=off."""
    global _worker_thread
    if not DEDUP_SYNC_ENABLED:
        logger.warning("dedup sync to BDRC is off (DEDUP_SYNC=off): answers stay queued here")
        return
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    _stop_event.clear()
    _worker_thread = threading.Thread(target=_worker_loop, name="dedup-sync-worker", daemon=True)
    _worker_thread.start()
    logger.info("dedup sync worker started (poll=%ss)", POLL_INTERVAL_SECONDS)


def stop_worker(timeout: float = 5.0) -> None:
    """Signal the worker to stop; an in-flight push is requeued by the stale sweep."""
    _stop_event.set()
    if _worker_thread is not None:
        _worker_thread.join(timeout=timeout)
