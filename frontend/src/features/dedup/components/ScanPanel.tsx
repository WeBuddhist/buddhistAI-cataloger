import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, ExternalLink, Loader2, RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List, useListRef, type RowComponentProps } from 'react-window';
import type { WitnessCard } from '../api/review';
import { pageImageUrl, pageListImageUrl, scanGroupOf, type ScanPage } from '../api/scans';
import { useOutlinePlace, useScanList } from '../hooks/useReview';
import { useProxyHeaders, useScanImage } from '../hooks/useScanImage';
import { useTextPlace } from '../hooks/useVolumes';
import { bestRange, outlineRange, scanAtShare, scanIndexAtChar, textPlaceRange, type ScanRange } from '../scanPlace';
import { formatNumber } from '../utils';

export type ScanTag = 'A' | 'B';

/** A place in a text: how far through it, from 0 to 1. */
export type ScanPoint = { tag: ScanTag; share: number };

// Space under each page for its number, and between pages.
const FOOTER_PX = 22;
const GAP_PX = 10;
// Row padding on each side, plus room for a classic (non-overlay) scrollbar.
const ROW_INSET_PX = 12 + 12 + 16;

// The scanned pages of A or B next to the texts, read side by side with them. Every page
// keeps its own shape (a volume often opens with portrait covers before the long pecha
// folios). Zoom is in place, as in the outliner: click a page to magnify it inside its own
// frame, move the pointer to look around, click again to zoom back out.
// Not modal: the review shortcuts keep working while it is open.
export default function ScanPanel({
  itemId,
  cards,
  tag,
  onTagChange,
  onClose,
  bottomInset = 0,
  pointAt = null,
}: Readonly<{
  itemId?: number;
  cards: Record<ScanTag, WitnessCard>;
  tag: ScanTag;
  onTagChange: (tag: ScanTag) => void;
  onClose: () => void;
  /** Height of anything docked at the bottom of the screen (the review action bar). */
  bottomInset?: number;
  /** Where to bring the scans, when a place in a text was clicked. */
  pointAt?: ScanPoint | null;
}>) {
  const { t } = useTranslation();
  const card = cards[tag];
  const imageGroup = scanGroupOf(card);
  const listQuery = useScanList(imageGroup);
  const pages = useMemo(() => listQuery.data?.pages ?? [], [listQuery.data]);
  const volumeNumber = listQuery.data?.volumeNumber ?? null;
  const getHeaders = useProxyHeaders();

  const listRef = useListRef(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [current, setCurrent] = useState(0);
  const [jump, setJump] = useState('');
  // Once the reader has moved the scans, finding the page late must not pull them away.
  const moved = useRef(false);

  // Where the text is. BDRC's catalogue gives the pages of texts from its outlines; the
  // others (and later pieces of an outline entry) are found through `/volumes`, which
  // downloads whole volumes, so that only runs when the catalogue cannot answer.
  const outlineQuery = useOutlinePlace(card.mw_id, Boolean(imageGroup));
  const outline = useMemo(
    () => (outlineQuery.data && pages.length > 0 ? outlineRange(outlineQuery.data, pages, volumeNumber) : null),
    [outlineQuery.data, pages, volumeNumber],
  );
  const outlineSettled = !outlineQuery.isPending;
  const searching = Boolean(imageGroup) && outlineSettled && listQuery.isSuccess && !outline?.exact;
  const place = useTextPlace(itemId, tag === 'A' ? 'a' : 'b', card, searching);
  const located = searching ? (place.data ?? null) : null;
  const found = useMemo(() => (located ? textPlaceRange(located, pages) : null), [located, pages]);
  const range = useMemo(() => bestRange(outline, found), [outline, found]);
  const finding = !outlineSettled || (searching && (place.isPending || place.isFetching));
  const startIndex = range?.start ?? null;

  // The scan `share` (0 to 1) of the way through the text. A position in the volume's text
  // follows it more closely than spreading the text evenly over its pages.
  const scanAt = useCallback(
    (share: number) => {
      if (!range) return null;
      if (located && found?.start === range.start) {
        return scanIndexAtChar(located, pages, located.start + share * (located.span ?? card.text_length ?? 0));
      }
      return scanAtShare(range, share);
    },
    [range, located, found, pages, card.text_length],
  );

  const showScan = useCallback(
    (index: number) => {
      listRef.current?.scrollToRow({ index, align: 'start' });
      setCurrent(index);
    },
    [listRef],
  );

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [imageGroup, pages.length]);

  useEffect(() => {
    setCurrent(0);
  }, [imageGroup]);

  useEffect(() => {
    moved.current = false;
  }, [card.mw_id]);

  // The list waits for the catalogue's answer (a second or so), so it does not first load
  // the volume's opening pages only to jump away from them.
  const listShown = boxWidth > ROW_INSET_PX && pages.length > 0 && outlineSettled;

  // Open at the page where the text starts.
  useEffect(() => {
    if (startIndex != null && listShown && !moved.current) showScan(startIndex);
  }, [card.mw_id, startIndex, listShown, showScan]);

  // Follow a click in the text.
  useEffect(() => {
    if (!pointAt || pointAt.tag !== tag || !listShown) return;
    const index = scanAt(pointAt.share);
    if (index != null) {
      moved.current = true;
      showScan(index);
    }
  }, [pointAt, tag, listShown, scanAt, showScan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const imageWidth = Math.max(0, boxWidth - ROW_INSET_PX);
  const rowHeight = useCallback(
    (index: number) => Math.ceil((imageWidth * pages[index].height) / pages[index].width) + FOOTER_PX + GAP_PX,
    [imageWidth, pages],
  );
  const rowProps = useMemo(
    () => ({
      pages,
      imageGroup: imageGroup ?? '',
      imageWidth,
      getHeaders,
      pageLabel: (n: number) => t('dedup.scans.page', { n: formatNumber(n), total: formatNumber(pages.length) }),
      failedLabel: t('dedup.scans.pageFailed'),
      retryLabel: t('dedup.scans.retry'),
    }),
    [pages, imageGroup, imageWidth, getHeaders, t],
  );
  const startTitle = startTitleOf(t, range, outline);

  const goToPage = (n: number) => {
    moved.current = true;
    showScan(Math.min(pages.length, Math.max(1, n)) - 1);
  };

  let body;
  if (!imageGroup) body = <Note>{t('dedup.witness.noScan')}</Note>;
  else if (listQuery.isLoading) body = <Note><Loader2 className="h-5 w-5 animate-spin" /></Note>;
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
  else if (!outlineSettled) body = <Note><Loader2 className="h-5 w-5 animate-spin" /></Note>;
  else
    body = imageWidth > 0 && (
      <List
        key={imageGroup}
        listRef={listRef}
        className="h-full [scrollbar-gutter:stable]"
        rowCount={pages.length}
        rowHeight={rowHeight}
        rowComponent={PageRow}
        rowProps={rowProps}
        overscanCount={2}
        onRowsRendered={({ startIndex }) => setCurrent(startIndex)}
      />
    );

  return (
    <section
      className="flex h-[75vh] min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm lg:sticky lg:top-2 lg:h-[var(--scan-h)]"
      style={{ '--scan-h': `calc(100dvh - ${bottomInset + 16}px)` } as React.CSSProperties}
      aria-label={t('dedup.witness.scannedPages')}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2">
        <div className="inline-flex rounded-md bg-gray-100 p-0.5" role="tablist" aria-label={t('dedup.witness.scannedPages')}>
          {(['A', 'B'] as const).map((k) => {
            const has = Boolean(scanGroupOf(cards[k]));
            return (
              <button
                key={k}
                role="tab"
                aria-selected={tag === k}
                disabled={!has}
                onClick={() => onTagChange(k)}
                title={has ? undefined : t('dedup.witness.noScan')}
                className={`cursor-pointer rounded px-2.5 py-0.5 text-sm font-medium disabled:cursor-not-allowed disabled:text-gray-300 ${
                  tag === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t('dedup.fullText.textTab', { tag: k })}
              </button>
            );
          })}
        </div>
        {pages.length > 0 && (
          <form
            className="flex items-center gap-1 text-xs tabular-nums text-gray-500"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(jump);
              if (Number.isFinite(n) && n > 0) goToPage(n);
              setJump('');
            }}
          >
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))}
              placeholder={formatNumber(current + 1)}
              inputMode="numeric"
              aria-label={t('dedup.scans.goToPage')}
              title={t('dedup.scans.goToPage')}
              className="w-12 rounded border border-gray-300 px-1.5 py-0.5 text-center text-gray-900 placeholder:text-gray-700"
            />
            / {formatNumber(pages.length)}
          </form>
        )}
        {finding && pages.length > 0 && <span className="text-xs text-gray-500">{t('dedup.scans.locating')}</span>}
        {startIndex != null && (
          <button
            type="button"
            onClick={() => {
              moved.current = true;
              showScan(startIndex);
            }}
            title={startTitle}
            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            <Crosshair className="h-3.5 w-3.5" /> {t('dedup.scans.textStart')}
          </button>
        )}
        {!finding && startIndex == null && pages.length > 0 && (
          <span className="text-xs text-gray-500">{t('dedup.scans.notLocated')}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {imageGroup && (
            <a
              // The image group, not `image_url`: BDRC's link drops the end of some ids.
              href={`https://library.bdrc.io/view/bdr:${imageGroup}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800"
            >
              {t('dedup.scans.openInBdrc')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            aria-label={t('dedup.scans.close')}
            title={t('dedup.scans.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div
        ref={boxRef}
        onWheelCapture={() => {
          moved.current = true;
        }}
        onTouchMoveCapture={() => {
          moved.current = true;
        }}
        className="min-h-0 flex-1 bg-gray-100"
      >
        {body}
      </div>
    </section>
  );
}

/** What the "Text start" button says about how sure the start is. */
function startTitleOf(t: (key: string, opts?: Record<string, unknown>) => string, range: ScanRange | null, outline: ScanRange | null) {
  if (range?.exact) return t('dedup.scans.goToText');
  // A later piece of an outline entry: BDRC records only the whole entry's pages.
  if (range && range.end != null && range.start === outline?.start) {
    return t('dedup.scans.goToTextInEntry', { from: formatNumber(range.start + 1), to: formatNumber(range.end + 1) });
  }
  return t('dedup.scans.goToTextApprox');
}

type PageRowProps = {
  pages: ScanPage[];
  imageGroup: string;
  imageWidth: number;
  getHeaders: () => Promise<HeadersInit | undefined>;
  pageLabel: (n: number) => string;
  failedLabel: string;
  retryLabel: string;
};

function PageRow({
  index,
  style,
  ariaAttributes,
  pages,
  imageGroup,
  imageWidth,
  getHeaders,
  pageLabel,
  failedLabel,
  retryLabel,
}: RowComponentProps<PageRowProps>) {
  const page = pages[index];
  const pixels = imageWidth * (globalThis.devicePixelRatio || 1);
  const listUrl = pageListImageUrl(imageGroup, page, pixels);
  const fullUrl = pageImageUrl(imageGroup, page);
  const image = useScanImage(listUrl, imageGroup, getHeaders);
  const height = Math.ceil((imageWidth * page.height) / page.width);
  let content;
  if (image.src) {
    content = (
      <ZoomableImage
        src={image.src}
        fullUrl={fullUrl === listUrl ? null : fullUrl}
        imageGroup={imageGroup}
        getHeaders={getHeaders}
        alt={pageLabel(index + 1)}
      />
    );
  } else if (image.failed) {
    content = (
      <span className="flex h-full flex-col items-center justify-center gap-2 p-2 text-center text-xs text-gray-500">
        {failedLabel}
        <RetryButton label={retryLabel} onClick={image.retry} />
      </span>
    );
  } else {
    content = (
      <span className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </span>
    );
  }
  return (
    <div {...ariaAttributes} style={style} className="px-3 pt-2.5">
      <div
        className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm"
        style={{ width: imageWidth, height }}
      >
        {content}
      </div>
      <div className="text-center text-[11px] leading-[22px] tabular-nums text-gray-500">
        {pageLabel(index + 1)}
      </div>
    </div>
  );
}

function RetryButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      <RotateCw className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

const ZOOM = 2.5;

// In-place zoom, like the outliner's: click to magnify inside the page's own frame, move the
// pointer to look around, click again to go back. The zoom is relative to the page as
// shown, so it is the same on every screen, and the page around it never moves (no
// scroll lock, no layout shift), so one click is always one zoom. The list shows a page
// about as wide as the panel; zooming in loads it at full size, over the smaller one.
function ZoomableImage({
  src,
  fullUrl,
  imageGroup,
  getHeaders,
  alt,
}: Readonly<{
  src: string;
  /** The page at full size; null when the list already shows it so. */
  fullUrl: string | null;
  imageGroup: string;
  getHeaders: () => Promise<HeadersInit | undefined>;
  alt: string;
}>) {
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');
  const full = useScanImage(zoomed ? fullUrl : null, imageGroup, getHeaders);
  const shown = full.src ?? src;
  const pointAt = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
    return `${x}% ${y}%`;
  };
  return (
    <button
      type="button"
      aria-label={alt}
      aria-pressed={zoomed}
      onClick={(e) => {
        setOrigin(pointAt(e));
        setZoomed((z) => !z);
      }}
      onMouseMove={(e) => zoomed && setOrigin(pointAt(e))}
      className={`block h-full w-full overflow-hidden ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
    >
      <img
        src={shown}
        alt=""
        draggable={false}
        className="h-full w-full select-none object-contain transition-transform duration-150 ease-out"
        style={{ transform: zoomed ? `scale(${ZOOM})` : undefined, transformOrigin: origin }}
      />
    </button>
  );
}

function Note({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">{children}</div>;
}
