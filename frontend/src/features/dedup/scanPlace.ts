// Where a text sits among its volume's scans, as indexes into the scan list. Two sources:
// BDRC's catalogue page range for texts from its outlines (exact, and nothing to download),
// and a position in a volume's text (`TextPlace`), found through `/volumes`.
// Plain data only, no app imports beyond the types.
import type { OutlinePlace, ScanPage } from './api/scans';
import { pageAt, type TextPlace } from './textPlace';

export interface ScanRange {
  /** Index of the scan the text starts on. */
  start: number;
  /** Index of the scan it ends on, when known. */
  end: number | null;
  /**
   * False when the start is only near the text: found by searching another OCR version, or
   * a later piece of an outline entry, which starts somewhere between `start` and `end`.
   */
  exact: boolean;
}

/**
 * The outline's page range in this volume's scans. Null when the scans are of a volume the
 * text is not in, or none of its pages are in the list.
 */
export function outlineRange(place: OutlinePlace, pages: ScanPage[], volumeNumber: number | null): ScanRange | null {
  const lastVolume = place.endVolume ?? place.volume;
  if (volumeNumber != null && (volumeNumber < place.volume || volumeNumber > lastVolume)) return null;
  // A text over several volumes runs from the top of the later ones, to the end of the earlier ones.
  const fromPage = volumeNumber == null || volumeNumber === place.volume ? place.start : 1;
  const toPage = volumeNumber == null || volumeNumber === lastVolume ? place.end : null;
  const start = pages.findIndex((p) => p.num >= fromPage);
  if (start < 0) return null;
  let end: number | null = null;
  if (toPage != null) {
    end = start;
    while (end + 1 < pages.length && pages[end + 1].num <= toPage) end++;
  }
  return { start, end, exact: place.piece == null || place.piece <= 1 };
}

/** Index of the scan holding a character of the volume; pages are matched by file name. */
export function scanIndexAtChar(place: TextPlace, pages: ScanPage[], char: number): number | null {
  const page = pageAt(place.pages, char);
  const index = page ? pages.findIndex((p) => p.filename === page.pname) : -1;
  return index >= 0 ? index : null;
}

/** The scans a position in a volume's text covers. */
export function textPlaceRange(place: TextPlace, pages: ScanPage[]): ScanRange | null {
  const start = scanIndexAtChar(place, pages, place.start);
  if (start == null) return null;
  const end = place.span == null ? null : scanIndexAtChar(place, pages, place.start + place.span);
  return { start, end: end != null && end >= start ? end : null, exact: place.exact };
}

/**
 * The best of what is known. An outline range is BDRC's own record and wins, except for a
 * later piece of an entry: a position found inside the entry's range is closer to its start.
 */
export function bestRange(outline: ScanRange | null, found: ScanRange | null): ScanRange | null {
  if (!outline) return found;
  if (outline.exact || !found) return outline;
  const inside = found.start >= outline.start && (outline.end == null || found.start <= outline.end);
  return inside ? { start: found.start, end: outline.end, exact: found.exact } : outline;
}

/** The scan `share` (0 to 1) of the way through the text. */
export function scanAtShare(range: ScanRange, share: number): number {
  if (range.end == null) return range.start;
  return range.start + Math.min(range.end - range.start, Math.floor(share * (range.end - range.start + 1)));
}
