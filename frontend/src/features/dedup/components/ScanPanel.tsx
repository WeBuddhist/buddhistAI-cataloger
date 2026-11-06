import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, ExternalLink, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List, useListRef, type RowComponentProps } from 'react-window';
import type { WitnessCard } from '../api/review';
import { pageImageUrl, scanGroupOf, type ScanPage } from '../api/scans';
import { useScanPages } from '../hooks/useReview';
import { useProxyHeaders, useScanImage } from '../hooks/useScanImage';
import { useTextPlace } from '../hooks/useVolumes';
import { pageAt } from '../textPlace';
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
  const pagesQuery = useScanPages(imageGroup);
  const pages = useMemo(() => pagesQuery.data ?? [], [pagesQuery.data]);
  const getHeaders = useProxyHeaders();

  const listRef = useListRef(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [current, setCurrent] = useState(0);
  const [jump, setJump] = useState('');
  const place = useTextPlace(itemId, tag === 'A' ? 'a' : 'b', card, Boolean(imageGroup));
  const located = place.data ?? null;
  const finding = place.isPending || place.isFetching;
  // Once the reader has moved the scans, finding the page late must not pull them away.
  const moved = useRef(false);

  // The scan holding a character of the volume: pages are matched by file name, since the
  // scan list leaves out the sheets in front of the volume.
  const scanIndexAt = useCallback(
    (char: number) => {
      const page = located && pageAt(located.pages, char);
      const index = page ? pages.findIndex((p) => p.filename === page.pname) : -1;
      return index >= 0 ? index : null;
    },
    [located, pages],
  );
  const startIndex = located ? scanIndexAt(located.start) : null;

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

  const listShown = boxWidth > ROW_INSET_PX && pages.length > 0;

  // Open at the page where the text starts.
  useEffect(() => {
    if (startIndex != null && listShown && !moved.current) showScan(startIndex);
  }, [card.mw_id, startIndex, listShown, showScan]);

  // Follow a click in the text.
  useEffect(() => {
    if (!pointAt || pointAt.tag !== tag || !located || !listShown) return;
    const length = located.span ?? card.text_length ?? 0;
    const index = scanIndexAt(located.start + pointAt.share * length);
    if (index != null) {
      moved.current = true;
      showScan(index);
    }
  }, [pointAt, tag, located, listShown, card.text_length, scanIndexAt, showScan]);

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
    }),
    [pages, imageGroup, imageWidth, getHeaders, t],
  );

  const goToPage = (n: number) => {
    moved.current = true;
    showScan(Math.min(pages.length, Math.max(1, n)) - 1);
  };

  let body;
  if (!imageGroup) body = <Note>{t('dedup.witness.noScan')}</Note>;
  else if (pagesQuery.isLoading) body = <Note><Loader2 className="h-5 w-5 animate-spin" /></Note>;
  else if (pagesQuery.error) body = <Note>{t('dedup.scans.loadFailed', { error: pagesQuery.error.message })}</Note>;
  else if (pages.length === 0) body = <Note>{t('dedup.scans.noPages')}</Note>;
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
            title={t(located?.exact ? 'dedup.scans.goToText' : 'dedup.scans.goToTextApprox')}
            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            <Crosshair className="h-3.5 w-3.5" /> {t('dedup.scans.textStart')}
          </button>
        )}
        {!finding && startIndex == null && pages.length > 0 && (
          <span className="text-xs text-gray-500">{t('dedup.scans.notLocated')}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {card.image_url && (
            <a
              href={card.image_url}
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

type PageRowProps = {
  pages: ScanPage[];
  imageGroup: string;
  imageWidth: number;
  getHeaders: () => Promise<HeadersInit | undefined>;
  pageLabel: (n: number) => string;
};

function PageRow({ index, style, ariaAttributes, pages, imageGroup, imageWidth, getHeaders, pageLabel }: RowComponentProps<PageRowProps>) {
  const page = pages[index];
  const src = useScanImage(pageImageUrl(imageGroup, page), getHeaders);
  const height = Math.ceil((imageWidth * page.height) / page.width);
  return (
    <div {...ariaAttributes} style={style} className="px-3 pt-2.5">
      <div
        className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm"
        style={{ width: imageWidth, height }}
      >
        {src ? (
          <ZoomableImage src={src} alt={pageLabel(index + 1)} />
        ) : (
          <span className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
          </span>
        )}
      </div>
      <div className="text-center text-[11px] leading-[22px] tabular-nums text-gray-500">{pageLabel(index + 1)}</div>
    </div>
  );
}

const ZOOM = 2.5;

// In-place zoom, like the outliner's: click to magnify inside the page's own frame, move the
// pointer to look around, click again to go back. The zoom is relative to the page as
// shown, so it is the same on every screen, and the page around it never moves (no
// scroll lock, no layout shift), so one click is always one zoom.
function ZoomableImage({ src, alt }: Readonly<{ src: string; alt: string }>) {
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');
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
        src={src}
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
