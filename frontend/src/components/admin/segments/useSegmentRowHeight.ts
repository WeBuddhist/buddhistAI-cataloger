import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DynamicRowHeight } from 'react-window';

/** Attribute react-window puts on each row element with its row index. */
const ROW_INDEX_ATTRIBUTE = 'data-react-window-index';
/** Assumed height of a row before anything has been measured. */
const DEFAULT_ROW_HEIGHT = 220;

/**
 * Like react-window's `useDynamicRowHeight`, but remembers measured heights by row id instead
 * of row index. A split, merge, or a row leaving a status filter shifts the indexes of the rows
 * after it; keyed by id, every row keeps its own height and the list does not jump.
 *
 * It also keeps what the reviewer is looking at still. Rows that have not been drawn yet use an
 * estimated height; when such a row above the visible area is drawn and turns out taller or
 * shorter, everything in view would shift by the difference. The scroll position is corrected
 * by exactly that difference, so the view stays put (scroll anchoring).
 *
 * `getScrollElement` returns the list's scrolling element (react-window's `listRef.current.element`).
 */
export function useSegmentRowHeight(
  rowIds: readonly string[],
  getScrollElement: () => HTMLElement | null | undefined
): DynamicRowHeight {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  // The resize observer outlives renders; it must resolve against the current values.
  const rowIdsRef = useRef(rowIds);
  rowIdsRef.current = rowIds;
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const getScrollElementRef = useRef(getScrollElement);
  getScrollElementRef.current = getScrollElement;

  // Height used for rows not drawn yet. Taken once, from the first rows measured, then kept:
  // a running average would change every time a tall segment is expanded, re-estimating every
  // undrawn row above the viewport at once.
  const estimateRef = useRef<number | null>(null);
  /** Scroll correction collected from rows above the viewport, applied after the next render. */
  const pendingScrollFixRef = useRef(0);

  const setRowHeight = useCallback((index: number, size: number) => {
    const id = rowIdsRef.current[index];
    if (id === undefined) return;
    setHeights((prev) => {
      if (prev.get(id) === size) return prev;
      const next = new Map(prev);
      next.set(id, size);
      return next;
    });
  }, []);

  const [observer] = useState(
    () =>
      new ResizeObserver((entries) => {
        const scrollElement = getScrollElementRef.current();
        const viewTop = scrollElement?.getBoundingClientRect().top;
        for (const entry of entries) {
          const index = Number.parseInt(entry.target.getAttribute(ROW_INDEX_ATTRIBUTE) ?? '', 10);
          const size = entry.borderBoxSize[0]?.blockSize;
          if (Number.isNaN(index) || !size) continue;
          const id = rowIdsRef.current[index];
          if (id === undefined) continue;
          const assumed = heightsRef.current.get(id) ?? estimateRef.current ?? DEFAULT_ROW_HEIGHT;
          // Only rows wholly above the visible area move the content in view when they resize.
          if (viewTop !== undefined && size !== assumed) {
            const rowTop = entry.target.getBoundingClientRect().top;
            if (rowTop + Math.max(size, assumed) <= viewTop) {
              pendingScrollFixRef.current += size - assumed;
            }
          }
          setRowHeight(index, size);
        }
      })
  );
  useEffect(() => () => observer.disconnect(), [observer]);

  // Apply the correction in the same frame the new heights are laid out, so nothing flickers.
  useLayoutEffect(() => {
    const fix = pendingScrollFixRef.current;
    if (fix === 0) return;
    pendingScrollFixRef.current = 0;
    const scrollElement = getScrollElementRef.current();
    if (scrollElement) scrollElement.scrollTop += fix;
  }, [heights]);

  const observeRowElements = useCallback(
    (elements: Element[] | NodeListOf<Element>) => {
      elements.forEach((el) => observer.observe(el));
      return () => elements.forEach((el) => observer.unobserve(el));
    },
    [observer]
  );

  return useMemo(() => {
    if (estimateRef.current === null && heights.size > 0) {
      let total = 0;
      for (const h of heights.values()) total += h;
      estimateRef.current = total / heights.size;
    }
    const estimate = estimateRef.current ?? DEFAULT_ROW_HEIGHT;
    return {
      getAverageRowHeight: () => estimate,
      getRowHeight: (index: number) => {
        const id = rowIds[index];
        return id === undefined ? undefined : heights.get(id);
      },
      setRowHeight,
      observeRowElements,
    };
  }, [heights, rowIds, setRowHeight, observeRowElements]);
}
