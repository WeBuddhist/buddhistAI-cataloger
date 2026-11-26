import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { bdrcPage } from '../utils';
import { useT } from '../i18n';

/**
 * Widths at which library.bdrc.io's own header is broken: from 1025 px its menu leaves the ☰
 * icon, and up to about 1400 px its Tibetan words don't fit in one row and overlap (seen
 * Nov 2026; it is BDRC's page, not the frame). Within them, the page is laid out at the
 * nearest clean width and scaled to the space: never more than about 18% bigger or 14% smaller.
 */
const BROKEN = { from: 1025, to: 1400 };
const CLEAN_NARROW = 1024;
const CLEAN_WIDE = 1400;

/** The width BDRC's page is laid out at, and its scale, for this much room. */
function layoutFor(width: number): { width: number; scale: number } {
  if (width < BROKEN.from || width >= BROKEN.to) return { width, scale: 1 };
  // Whichever clean width is nearer in proportion.
  const target = width / CLEAN_NARROW < CLEAN_WIDE / width ? CLEAN_NARROW : CLEAN_WIDE;
  return { width: target, scale: width / target };
}

/** A live page of library.bdrc.io, with a link to open it outside. `children` go at the start of
 * the bar above it. */
export default function BdrcFrame({
  bdrcId,
  title,
  children,
}: Readonly<{ bdrcId: string; title: string; children?: ReactNode }>) {
  const t = useT();
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const url = bdrcPage(bdrcId);
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setRoom({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = layoutFor(room.width);
  const scaled = layout.scale !== 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-1.5 text-sm">
        {children}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
        >
          {t('bdrcFrame.openNewTab')} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-white">
        {loadedId !== bdrcId && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('bdrcFrame.loading')}
          </div>
        )}
        {/* Sandboxed so the page cannot navigate the Cataloger away from this text. */}
        <iframe
          key={bdrcId}
          src={url}
          title={title}
          onLoad={() => setLoadedId(bdrcId)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          className="absolute left-0 top-0 border-0"
          style={
            scaled
              ? {
                  width: layout.width,
                  height: room.height / layout.scale,
                  transform: `scale(${layout.scale})`,
                  transformOrigin: 'top left',
                }
              : { width: '100%', height: '100%' }
          }
        />
      </div>
    </div>
  );
}
