import { useState, type ReactNode } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { bdrcPage } from '../utils';
import { useT } from '../i18n';

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
      <div className="relative min-h-0 flex-1 bg-white">
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
          className="relative h-full w-full border-0"
        />
      </div>
    </div>
  );
}
