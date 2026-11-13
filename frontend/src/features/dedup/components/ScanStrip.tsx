import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, ExternalLink, Loader2, LocateFixed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List, useListRef } from 'react-window';
import type { WitnessCard } from '../api/review';
import { useProxyHeaders } from '../hooks/useScanImage';
import { useScanLocation } from '../hooks/useScanLocation';
import { formatNumber } from '../utils';
import { pageWidth } from '../scanPlace';
import { Note, PageRow, RetryButton, type ScanTag } from './ScanPanel';

/**
 * Where the reader is in a text: how far through it (0 to 1, outside that before or after
 * it), and the words of the line at the top, to find that line's page in the scans.
 */
export type ReadingSpot = { share: number; words?: string };

/** Where the reader is in each text; null: unknown. */
export type ReadingPlace = Record<ScanTag, ReadingSpot | null>;

// As in the Scan tab: space under each page for its number, and above it (the row's top
// padding); row padding on each side plus a scrollbar.
const FOOTER_PX = 22;
const GAP_PX = 10;
const ROW_INSET_PX = 12 + 12 + 16;

// The scans under the full texts, one copy at a time so its page gets the whole width:
// side by side, each was too small to read without zooming. Both stay mounted, each
// following its text, moving only when the page being read changes. Moving a scan by
// hand stops that until "Back to text".
export default function ScanStrip({
  itemId,
  cards,
  place,
}: Readonly<{ itemId?: number; cards: Record<ScanTag, WitnessCard>; place: ReadingPlace }>) {
  const { t } = useTranslation();
  const [tag, setTag] = useState<ScanTag>('A');
  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-100">
      <div className="flex border-b border-gray-200 bg-white" role="tablist">
        {(['A', 'B'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tag === k}
            onClick={() => setTag(k)}
            className={`flex-1 cursor-pointer py-1.5 text-sm font-medium ${
              tag === k ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500'
            }`}
          >
            {t('dedup.fullText.textTab', { tag: k })}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1">
        <ScanColumn tag="A" card={cards.A} itemId={itemId} spot={place.A} className={tag === 'A' ? 'flex' : 'hidden'} />
        <ScanColumn tag="B" card={cards.B} itemId={itemId} spot={place.B} className={tag === 'B' ? 'flex' : 'hidden'} />
      </div>
    </div>
  );
}

const BADGE: Record<ScanTag, string> = { A: 'bg-red-100 text-red-800', B: 'bg-green-100 text-green-800' };

function ScanColumn({
  tag,
  card,
  itemId,
  spot,
  className,
}: Readonly<{ tag: ScanTag; card: WitnessCard; itemId?: number; spot: ReadingSpot | null; className: string }>) {
  const { t } = useTranslation();
  const { imageGroup, listQuery, pages, outlineSettled, finding, lineByLine, startIndex, scanAt } = useScanLocation(
    card,
    tag === 'A' ? 'a' : 'b',
    itemId,
    { precise: true },
  );
  const getHeaders = useProxyHeaders();
  const listRef = useListRef(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState(0);
  const [following, setFollowing] = useState(true);
  // The page last brought into view for the text: the scan only moves when this changes.
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setBox({ width: Math.floor(e.contentRect.width), height: Math.floor(e.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [imageGroup, pages.length]);

  const imageWidth = Math.max(0, box.width - ROW_INSET_PX);
  // A whole page fits in the strip, however tall it is.
  const maxImageHeight = Math.max(40, box.height - FOOTER_PX - GAP_PX);
  const listShown = imageWidth > 0 && pages.length > 0 && outlineSettled;
  const target = useMemo(
    () => (spot == null ? startIndex : (scanAt(spot.share, spot.words) ?? startIndex)),
    [spot, startIndex, scanAt],
  );

  const rowHeight = useCallback(
    (index: number) => {
      const p = pages[index];
      return Math.ceil((pageWidth(p, imageWidth, maxImageHeight) * p.height) / p.width) + FOOTER_PX + GAP_PX;
    },
    [pages, imageWidth, maxImageHeight],
  );

  // Scrolls the list itself and checks it got there: a list that has only just appeared
  // ignores a jump until it is laid out, so it tries again on the next frames. Only a
  // jump that landed counts as shown, so a missed one is never taken for done.
  const frame = useRef(0);
  const showScan = useCallback(
    (index: number) => {
      cancelAnimationFrame(frame.current);
      let tries = 0;
      const go = () => {
        const el = listRef.current?.element;
        let offset = 0;
        for (let i = 0; i < index; i++) offset += rowHeight(i);
        if (el) el.scrollTop = offset;
        const landed = el != null && el.clientHeight > 0 && Math.abs(el.scrollTop - Math.min(offset, el.scrollHeight - el.clientHeight)) <= 2;
        if (landed) {
          shown.current = index;
          setCurrent(index);
        } else if (tries++ < 30) {
          frame.current = requestAnimationFrame(go);
        }
      };
      go();
    },
    [listRef, rowHeight],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // A resized strip changes every row's height: bring the page back into place.
  useEffect(() => {
    shown.current = null;
  }, [box.width, box.height, imageGroup]);

  useEffect(() => {
    if (!following || !listShown || target == null || shown.current === target) return;
    showScan(target);
  }, [following, listShown, target, showScan, box]);

  const byHand = () => setFollowing(false);
  const step = (by: number) => {
    byHand();
    showScan(Math.min(pages.length - 1, Math.max(0, current + by)));
  };
  const backToText = () => {
    shown.current = null;
    setFollowing(true);
  };

  const rowProps = useMemo(
    () => ({
      pages,
      imageGroup: imageGroup ?? '',
      imageWidth,
      maxImageHeight,
      getHeaders,
      pageLabel: (n: number) => t('dedup.scans.page', { n: formatNumber(n), total: formatNumber(pages.length) }),
      failedLabel: t('dedup.scans.pageFailed'),
      retryLabel: t('dedup.scans.retry'),
    }),
    [pages, imageGroup, imageWidth, maxImageHeight, getHeaders, t],
  );

  let body;
  if (!imageGroup) body = <Note>{t('dedup.witness.noScan')}</Note>;
  else if (listQuery.isLoading || (pages.length > 0 && !outlineSettled)) body = <Note><Loader2 className="h-5 w-5 animate-spin" /></Note>;
  else if (listQuery.error)
    body = (
      <Note>
        <span className="flex flex-col items-center gap-2">
          {t('dedup.scans.loadFailed', { error: listQuery.error.message })}
          <RetryButton label={t('dedup.scans.retry')} onClick={() => void listQuery.refetch()} />
        </span>
      </Note>
    );
  else if (pages.length === 0) body = <Note>{t('dedup.scans.noPages')}</Note>;
  else
    body = listShown && (
      <List
        key={imageGroup}
        listRef={listRef}
        className="h-full [scrollbar-gutter:stable]"
        rowCount={pages.length}
        rowHeight={rowHeight}
        rowComponent={PageRow}
        rowProps={rowProps}
        overscanCount={1}
        onRowsRendered={({ startIndex: first }) => setCurrent(first)}
      />
    );

  return (
    <section data-scan-side={tag} className={`${className} min-h-0 min-w-0 flex-col`} aria-label={t('dedup.fullText.scansOf', { tag })}>
      <header className="flex min-h-9 flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-2 py-1 text-xs text-gray-600">
        <span className={`rounded px-1.5 text-sm font-semibold ${BADGE[tag]}`}>{tag}</span>
        {pages.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={current <= 0}
              aria-label={t('dedup.scans.previousPage')}
              title={t('dedup.scans.previousPage')}
              className="cursor-pointer rounded p-0.5 hover:bg-gray-100 disabled:cursor-default disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">
              {formatNumber(current + 1)} / {formatNumber(pages.length)}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={current >= pages.length - 1}
              aria-label={t('dedup.scans.nextPage')}
              title={t('dedup.scans.nextPage')}
              className="cursor-pointer rounded p-0.5 hover:bg-gray-100 disabled:cursor-default disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
        {finding && pages.length > 0 && <span className="text-gray-500">{t('dedup.scans.locating')}</span>}
        {!finding && startIndex == null && pages.length > 0 && <span className="text-gray-500">{t('dedup.scans.notLocated')}</span>}
        {/* Always says whether the scan is on the text's page, so page 1 never looks like a stuck scan. */}
        {following && target != null && listShown && (
          <span
            className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-600"
            title={t(lineByLine ? 'dedup.scans.followingTitle' : 'dedup.scans.followingApproxTitle')}
          >
            <LocateFixed className="h-3.5 w-3.5" /> {t(lineByLine ? 'dedup.scans.following' : 'dedup.scans.followingApprox')}
          </span>
        )}
        {!following && target != null && (
          <button
            type="button"
            onClick={backToText}
            className="inline-flex cursor-pointer items-center gap-1 rounded bg-blue-50 px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100"
          >
            <LocateFixed className="h-3.5 w-3.5" /> {t('dedup.scans.backToText')}
          </button>
        )}
        {startIndex != null && listShown && (
          <button
            type="button"
            onClick={() => {
              byHand();
              showScan(startIndex);
            }}
            title={t('dedup.scans.goToText')}
            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-100"
          >
            <Crosshair className="h-3.5 w-3.5" /> {t('dedup.scans.textStart')}
          </button>
        )}
        {imageGroup && (
          <a
            href={`https://library.bdrc.io/view/bdr:${imageGroup}`}
            target="_blank"
            rel="noreferrer"
            title={t('dedup.scans.openInBdrc')}
            aria-label={t('dedup.scans.openInBdrc')}
            className="ml-auto inline-flex items-center rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </header>
      <div ref={boxRef} onWheelCapture={byHand} onTouchMoveCapture={byHand} className="min-h-0 flex-1">
        {body}
      </div>
    </section>
  );
}
