import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { getAuth0AccessToken } from '@/lib/auth0AccessToken';
import { proxiedImageUrl } from '@/lib/imageProxy';

/** Headers for the backend image proxy (restricted pages). Never sent to IIIF itself. */
export function useProxyHeaders() {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  return useCallback(async (): Promise<HeadersInit | undefined> => {
    if (!isAuthenticated) return undefined;
    const token = await getAuth0AccessToken(getAccessTokenSilently);
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }, [getAccessTokenSilently, isAuthenticated]);
}

// BDRC takes seconds to make each page and fails some when asked for many at once, so pages
// are fetched a few at a time, each given a few tries before the reader is told.
const MAX_AT_ONCE = 4;
const TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_500, 4_000];

// Image groups BDRC refused a direct page of (401/403): their pages go to the proxy first.
const restrictedGroups = new Set<string>();

let running = 0;
const waiting: Array<() => void> = [];

/**
 * Runs `task` once fewer than MAX_AT_ONCE are running; gives up its place if aborted while
 * waiting. A finished task hands its slot straight to the next one waiting.
 */
async function inTurn<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  if (running < MAX_AT_ONCE) running++;
  else {
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal.removeEventListener('abort', leave);
        resolve();
      };
      const leave = () => {
        const i = waiting.indexOf(go);
        if (i >= 0) waiting.splice(i, 1);
        reject(signal.reason);
      };
      waiting.push(go);
      signal.addEventListener('abort', leave, { once: true });
    });
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

type Outcome = { blob: Blob } | { status: number | null };

/** One request, cut off after TIMEOUT_MS. `status` null: no answer (network, timeout). */
async function fetchOnce(url: string, signal: AbortSignal, headers?: HeadersInit): Promise<Outcome> {
  const timeout = new AbortController();
  const stop = () => timeout.abort();
  const timer = setTimeout(stop, TIMEOUT_MS);
  signal.addEventListener('abort', stop, { once: true });
  try {
    const res = await fetch(url, { signal: timeout.signal, headers });
    if (!res.ok) return { status: res.status };
    return { blob: await res.blob() };
  } catch {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    return { status: null };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * A page image: straight from IIIF, or through the proxy for pages BDRC restricts (access
 * is per page, so a page of an open volume can still be refused). Throws only when aborted.
 */
async function loadPage(
  url: string,
  imageGroup: string,
  getHeaders: () => Promise<HeadersInit | undefined>,
  signal: AbortSignal,
): Promise<Blob | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1], signal);
    const blob = await tryPage(url, imageGroup, getHeaders, signal);
    if (blob) return blob;
  }
  return null;
}

/** One try: directly (unless the group is known restricted), then through the proxy. */
async function tryPage(
  url: string,
  imageGroup: string,
  getHeaders: () => Promise<HeadersInit | undefined>,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (!restrictedGroups.has(imageGroup)) {
    const direct = await inTurn(signal, () => fetchOnce(url, signal));
    if ('blob' in direct) return direct.blob;
    if (direct.status === 401 || direct.status === 403) restrictedGroups.add(imageGroup);
  }
  const proxied = proxiedImageUrl(url);
  if (!proxied || proxied === url) return null;
  const headers = await getHeaders();
  const viaProxy = await inTurn(signal, () => fetchOnce(proxied, signal, headers));
  return 'blob' in viaProxy ? viaProxy.blob : null;
}

export type ScanImage = {
  /** Object URL of the loaded page; null while loading or after failing. */
  src: string | null;
  /** Every try failed: show the reader, with `retry`. */
  failed: boolean;
  retry: () => void;
};

/** One scanned page, loaded with retries; nothing is fetched while `url` is null. */
export function useScanImage(
  url: string | null,
  imageGroup: string,
  getHeaders: () => Promise<HeadersInit | undefined>,
): ScanImage {
  const [state, setState] = useState<{ url: string | null; src: string | null; failed: boolean }>({
    url: null,
    src: null,
    failed: false,
  });
  const [round, setRound] = useState(0);
  const headersRef = useRef(getHeaders);
  headersRef.current = getHeaders;

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    let objectUrl: string | null = null;
    setState({ url, src: null, failed: false });
    loadPage(url, imageGroup, () => headersRef.current(), ac.signal)
      .then((blob) => {
        if (ac.signal.aborted) return;
        objectUrl = blob && URL.createObjectURL(blob);
        setState({ url, src: objectUrl, failed: !blob });
      })
      .catch(() => {
        // Aborted: the row scrolled away or the page changed.
      });
    return () => {
      ac.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, imageGroup, round]);

  const retry = useCallback(() => setRound((r) => r + 1), []);
  const current = state.url === url;
  return { src: current ? state.src : null, failed: current && state.failed, retry };
}
