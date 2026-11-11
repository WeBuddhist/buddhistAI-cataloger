import { useCallback, useMemo } from 'react';
import type { WitnessCard } from '../api/review';
import { scanGroupOf } from '../api/scans';
import { bestRange, outlineRange, scanAtShare, scanIndexAtChar, textPlaceRange } from '../scanPlace';
import { useOutlinePlace, useScanList } from './useReview';
import { useTextPlace } from './useVolumes';

/**
 * A text's scans, and where the text is among them. BDRC's catalogue gives the pages of
 * texts from its outlines; the others (and later pieces of an outline entry) are found
 * through `/volumes`, which downloads whole volumes, so that only runs when the catalogue
 * cannot answer. Shared by the Scan tab and the scans under the full texts.
 */
export function useScanLocation(
  card: WitnessCard,
  side: 'a' | 'b',
  itemId?: number,
  {
    precise = false,
  }: {
    /**
     * Also find the text in its volume when the catalogue already gives its pages, to know
     * the page of every line (the catalogue only gives the range: spreading the text evenly
     * over it puts lines a page or more off, as a text's first page is mostly title). For
     * following the reader; it downloads the volume, shared with the Full volume tab.
     */
    precise?: boolean;
  } = {},
) {
  const imageGroup = scanGroupOf(card);
  const listQuery = useScanList(imageGroup);
  const pages = useMemo(() => listQuery.data?.pages ?? [], [listQuery.data]);
  const volumeNumber = listQuery.data?.volumeNumber ?? null;

  const outlineQuery = useOutlinePlace(card.mw_id, Boolean(imageGroup));
  const outline = useMemo(
    () => (outlineQuery.data && pages.length > 0 ? outlineRange(outlineQuery.data, pages, volumeNumber) : null),
    [outlineQuery.data, pages, volumeNumber],
  );
  const outlineSettled = !outlineQuery.isPending;
  const searching = Boolean(imageGroup) && outlineSettled && listQuery.isSuccess && (precise || !outline?.exact);
  const place = useTextPlace(itemId, side, card, searching);
  const located = searching ? (place.data ?? null) : null;
  const found = useMemo(() => (located ? textPlaceRange(located, pages) : null), [located, pages]);
  const range = useMemo(() => bestRange(outline, found), [outline, found]);
  // An exact outline is never waited on: the search only sharpens it.
  const finding = !outlineSettled || (searching && !outline?.exact && (place.isPending || place.isFetching));
  // The search's page for each character is used when it agrees with where the text is:
  // it starts within a page of the range's start and inside the range.
  const lineByLine =
    located != null &&
    found != null &&
    range != null &&
    (found.start === range.start ||
      (precise && Math.abs(found.start - range.start) <= 1 && (range.end == null || found.start <= range.end)));

  // The scan `share` of the way through the text (0 to 1; outside that, before or after
  // it in the volume). A position in the volume's text follows it more closely than
  // spreading the text evenly over its pages.
  const scanAt = useCallback(
    (share: number) => {
      if (!range) return null;
      let index: number | null;
      if (lineByLine && located) {
        index = scanIndexAtChar(located, pages, located.start + share * (located.span ?? card.text_length ?? 0));
      } else if (share >= 0 && share <= 1) {
        index = scanAtShare(range, share);
      } else {
        // Before or after the text: carry on at the text's pages per character.
        const span = range.end == null ? 1 : range.end - range.start + 1;
        index = range.start + Math.floor(share * span);
      }
      return index == null ? null : Math.min(pages.length - 1, Math.max(0, index));
    },
    [range, located, lineByLine, pages, card.text_length],
  );

  return { imageGroup, listQuery, pages, outline, outlineSettled, range, finding, lineByLine, startIndex: range?.start ?? null, scanAt };
}
