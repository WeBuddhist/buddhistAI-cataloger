import { useEffect } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription } from '@/components/ui/dialog';
import { usePrefetchPerson } from '../hooks';
import type { BdrcPerson } from '../types';
import PersonInfobox from './PersonInfobox';
import { bdrcPage } from '../utils';
import { useT } from '../i18n';
import { useToolScope } from '../tibetan';

/** What BDRC knows about a person, with the other results one step away. */
export default function PersonDialog({
  persons,
  index,
  total,
  selectedIds,
  loadingMore,
  loadFailed,
  onIndexChange,
  onSelect,
  onReport,
  onClose,
}: Readonly<{
  persons: BdrcPerson[];
  /** Which result is open; null when closed. */
  index: number | null;
  total: number;
  selectedIds: string[];
  /** More results are on their way. */
  loadingMore: boolean;
  loadFailed: boolean;
  /** Can be one past those loaded, for the next ones. */
  onIndexChange: (index: number) => void;
  onSelect: (person: BdrcPerson) => void;
  onReport: (person: BdrcPerson) => void;
  onClose: () => void;
}>) {
  const t = useT();
  const scope = useToolScope();
  const person = index == null ? undefined : persons[index];
  const selected = person != null && selectedIds.includes(person.id);

  const prefetch = usePrefetchPerson();
  const beforeId = index == null ? undefined : persons[index - 1]?.id;
  const afterId = index == null ? undefined : persons[index + 1]?.id;
  useEffect(() => {
    if (afterId) prefetch(afterId);
    if (beforeId) prefetch(beforeId);
  }, [afterId, beforeId, prefetch]);

  return (
    <Dialog open={person != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={`${scope} flex h-[90dvh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-3xl`}
      >
        {person && index != null && (
          <>
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Button variant="outline" size="icon-sm" aria-label={t('dialog.previous')} title={t('dialog.previous')} className="cursor-pointer" disabled={index === 0} onClick={() => onIndexChange(index - 1)}>
                  <ChevronLeft />
                </Button>
                {/* As wide for every number, so that the buttons stay under the pointer. */}
                <DialogDescription className="min-w-24 whitespace-nowrap text-center text-sm tabular-nums text-gray-600">
                  {t('dialog.position', { n: index + 1, total })}
                </DialogDescription>
                <Button variant="outline" size="icon-sm" aria-label={t('dialog.next')} title={t('dialog.next')} className="cursor-pointer" disabled={index >= total - 1 || (loadingMore && index >= persons.length - 1)} onClick={() => onIndexChange(index + 1)}>
                  {loadingMore && index >= persons.length - 1 ? <Loader2 className="animate-spin" /> : <ChevronRight />}
                </Button>
                {loadFailed && index >= persons.length - 1 && <span className="min-w-0 truncate text-xs text-red-700">{t('search.loadMoreFailed')}</span>}
              </div>
              <a
                href={bdrcPage(person.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 px-2 text-sm font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
              >
                {t('dialog.openOnBdrc')} <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.close')} className="cursor-pointer">
                  <X />
                </Button>
              </DialogClose>
            </div>
            {/* Keyed so the next person starts at the top, with long lists folded. */}
            <div key={person.id} className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-4">
              <PersonInfobox person={person} />
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3">
              <Button variant="ghost" className="mr-auto cursor-pointer text-gray-600" onClick={() => onReport(person)}>
                <Copy /> {t('person.reportDuplicate')}
              </Button>
              <Button variant="outline" className="cursor-pointer" onClick={onClose}>
                {t('dialog.back')}
              </Button>
              <Button className="cursor-pointer bg-blue-600 text-white hover:bg-blue-700" onClick={() => onSelect(person)}>
                {selected && <Check />} {selected ? t('dialog.selected') : t('dialog.select')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
