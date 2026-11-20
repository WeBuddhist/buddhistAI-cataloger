import { useCallback, useEffect, useState } from 'react';

/** Our own scan list, or BDRC's viewer shown inside the tool. */
export type ScanView = 'scans' | 'bdrc';
const VIEW_KEY = 'dedup.scanView';
const VIEW_EVENT = 'dedup-scan-view';

function savedView(): ScanView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'bdrc' ? 'bdrc' : 'scans';
  } catch {
    return 'scans';
  }
}

/** The chosen view, shared by the side panel and the full-text dialog's strip, and kept
 * for next time. */
export function useScanView(): [ScanView, (v: ScanView) => void] {
  const [view, setView] = useState<ScanView>(savedView);
  useEffect(() => {
    const onChange = (e: Event) => setView((e as CustomEvent<ScanView>).detail);
    window.addEventListener(VIEW_EVENT, onChange);
    return () => window.removeEventListener(VIEW_EVENT, onChange);
  }, []);
  const choose = useCallback((v: ScanView) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Only a convenience: the views still work without it.
    }
    window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: v }));
  }, []);
  return [view, choose];
}

/** BDRC's viewer for a scan: the same page "Open on BDRC" opens (the whole volume). */
export function bdrcViewerUrl(imageGroup: string | null | undefined): string | null {
  return imageGroup ? `https://library.bdrc.io/view/bdr:${imageGroup}` : null;
}
