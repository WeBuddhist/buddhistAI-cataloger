import { useCallback, useEffect, useRef } from 'react';
import { addActiveTime } from '../api/review';

// Counts only while the pair is on screen, the tab is in front, and there was mouse,
// keyboard, scroll or touch activity in the last few minutes (long full-text reading
// included). Each visit's time is sent and added up on the server.
//
// A pair that was already answered when the visit began only gets the visit's time if
// the visit ends with a new answer (`commit`); rereading it and leaving adds nothing.
const IDLE_AFTER_MS = 2.5 * 60 * 1000;
// Inside an embedded page (BDRC's viewer) the browser hides the mouse and keys from us, so
// while the pointer is over it or it has focus, time counts for this long after the last
// sign of work we can see (the pointer going into it, a click into it, anything on our
// own page).
const EMBED_IDLE_AFTER_MS = 10 * 60 * 1000;

/** A frame marked `data-counts-active-time` (the BDRC viewer). */
function isCountedFrame(el: EventTarget | Element | null): boolean {
  return el instanceof HTMLIFrameElement && el.dataset.countsActiveTime !== undefined;
}

/** Focus is inside a counted frame. */
function inCountedFrame(): boolean {
  return isCountedFrame(document.activeElement);
}
const TICK_MS = 1000;
const FLUSH_EVERY_MS = 60 * 1000;
const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

export function useActiveTimer(itemId: number | undefined, enabled: boolean, alreadyAnswered: boolean) {
  const counted = useRef(0);
  const lastActivity = useRef(Date.now());
  // Fixed for the visit: answering during the visit does not change how it is counted.
  const holdForAnswer = useRef(false);

  const send = useCallback(
    (keepalive: boolean) => {
      const seconds = Math.floor(counted.current / 1000);
      if (!itemId || seconds < 1) return;
      counted.current -= seconds * 1000;
      addActiveTime(itemId, Math.min(seconds, 3600), keepalive).catch(() => {
        counted.current += seconds * 1000; // try again with the next send
      });
    },
    [itemId],
  );

  // Leaving, tab hidden, or the one-minute save.
  const flush = useCallback(
    (keepalive = false) => {
      if (!holdForAnswer.current) send(keepalive);
    },
    [send],
  );

  /** Call when the annotator saves an answer: this visit's time always counts then. */
  const commit = useCallback(() => {
    send(false);
    holdForAnswer.current = false;
  }, [send]);

  useEffect(() => {
    if (!enabled || !itemId) return;
    counted.current = 0;
    lastActivity.current = Date.now();
    holdForAnswer.current = alreadyAnswered;

    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { capture: true, passive: true }));
    // Clicking into the BDRC viewer blurs our window; focus has moved to the frame by the
    // next task.
    let blurCheck: number | undefined;
    const onBlur = () => {
      window.clearTimeout(blurCheck);
      blurCheck = window.setTimeout(() => {
        if (inCountedFrame()) onActivity();
      }, 0);
    };
    window.addEventListener('blur', onBlur);
    // Our page sees the pointer go into the frame (an event on the frame itself), then
    // nothing until it comes back out onto our page. Reading or wheel-scrolling there
    // without clicking is work too.
    let overFrame = false;
    const onOver = (e: MouseEvent) => {
      overFrame = isCountedFrame(e.target);
      if (overFrame) onActivity();
    };
    // Leaving the window: from the frame itself our page does not hear it, so this only
    // clears it when the pointer leaves from our own page.
    const onOut = (e: MouseEvent) => {
      if (e.relatedTarget == null && !isCountedFrame(e.target)) overFrame = false;
    };
    window.addEventListener('mouseover', onOver, { capture: true, passive: true });
    window.addEventListener('mouseout', onOut, { capture: true, passive: true });

    const tick = window.setInterval(() => {
      const idleAfter = overFrame || inCountedFrame() ? EMBED_IDLE_AFTER_MS : IDLE_AFTER_MS;
      const inUse =
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        Date.now() - lastActivity.current < idleAfter;
      if (inUse) counted.current += TICK_MS;
    }, TICK_MS);
    const periodic = window.setInterval(() => flush(), FLUSH_EVERY_MS);

    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mouseover', onOver, { capture: true });
      window.removeEventListener('mouseout', onOut, { capture: true });
      window.clearTimeout(blurCheck);
      window.clearInterval(tick);
      window.clearInterval(periodic);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flush(true); // leaving this pair (next / previous / back); dropped if held
      counted.current = 0;
    };
    // alreadyAnswered is read once per visit on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, itemId, flush]);

  return { flush, commit };
}
