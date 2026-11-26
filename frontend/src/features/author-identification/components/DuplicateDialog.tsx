import { useState, type FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUser } from '@/hooks/useUser';
import { useDuplicates, usePersonSearch, useRemoveDuplicate, useReportDuplicate } from '../hooks';
import type { BdrcPerson } from '../types';
import { cleanName, FIELD, reportOfPair } from '../utils';
import { useT } from '../i18n';

/** Report that a person has a second BDRC id. It is only reported: nothing changes in BDRC. */
export default function DuplicateDialog({
  person,
  searched: startName,
  text,
  onClose,
}: Readonly<{
  person: BdrcPerson;
  /** The search they were found with; their double is likely in it too. */
  searched: string;
  text: { id: string; title: string };
  onClose: () => void;
}>) {
  const t = useT();
  const { user } = useUser();
  const duplicates = useDuplicates();
  const report = useReportDuplicate();
  const undo = useRemoveDuplicate();
  const [query, setQuery] = useState(startName);
  const [searched, setSearched] = useState(startName);
  const [other, setOther] = useState<BdrcPerson | null>(null);
  const [reason, setReason] = useState('');
  const search = usePersonSearch(searched);

  const results = (search.data?.pages.flatMap((p) => p.persons) ?? []).filter((p) => p.id !== person.id);
  const known = other && reportOfPair(person.id, other.id, duplicates.data);
  const ready = other != null && !known && reason.trim() !== '';

  const find = (e: FormEvent) => {
    e.preventDefault();
    setSearched(cleanName(query));
    setOther(null);
  };
  const send = async () => {
    if (!ready || report.isPending) return;
    try {
      const saved = await report.mutateAsync({
        persons: [person, other],
        reason: reason.trim(),
        text,
        reportedBy: user?.name || user?.email || 'Unknown',
      });
      onClose();
      toast.success(t('duplicate.sent'), {
        position: 'top-center',
        action: { label: t('duplicate.undo'), onClick: () => undo.mutate(saved.id) },
      });
    } catch {
      toast.error(t('duplicate.sendFailed'), { position: 'top-center' });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-xl">
        <div className="border-b border-gray-200 px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold">{t('duplicate.title')}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-gray-600">
            {t('duplicate.description')}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <h3 className="mb-1 text-sm font-medium text-gray-700">{t('duplicate.thisPerson')}</h3>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <PersonLines person={person} />
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-medium text-gray-700">{t('duplicate.isSameAs')}</h3>
            <form onSubmit={find} className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t('duplicate.otherName')}
                placeholder={t('search.placeholder')}
                className={`h-9 flex-1 font-monlam text-base md:text-base ${FIELD}`}
              />
              <Button type="submit" variant="outline" className="cursor-pointer bg-white" disabled={!cleanName(query)}>
                <Search /> {t('search.find')}
              </Button>
            </form>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
              {search.isLoading && (
                <p className="flex items-center gap-2 px-3 py-3 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('search.searching')}
                </p>
              )}
              {search.isError && <p className="px-3 py-3 text-sm text-red-700">{t('duplicate.searchFailed')}</p>}
              {!search.isLoading && !search.isError && results.length === 0 && (
                <p className="px-3 py-3 text-sm text-gray-500">{t('duplicate.nobodyElse')}</p>
              )}
              <ul className="divide-y divide-gray-100">
                {results.map((p) => (
                  <li key={p.id}>
                    <label className={`flex cursor-pointer gap-3 px-3 py-1.5 ${other?.id === p.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <input
                        type="radio"
                        name="duplicate-person"
                        checked={other?.id === p.id}
                        onChange={() => setOther(p)}
                        className="mt-2 h-4 w-4 shrink-0 accent-blue-600"
                      />
                      <PersonLines person={p} />
                    </label>
                  </li>
                ))}
              </ul>
              {search.hasNextPage && (
                <button
                  type="button"
                  onClick={() => search.fetchNextPage()}
                  disabled={search.isFetchingNextPage}
                  className="w-full cursor-pointer border-t border-gray-100 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-gray-50"
                >
                  {search.isFetchingNextPage ? t('common.loading') : t('duplicate.showMore')}
                </button>
              )}
            </div>
            {known && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {known.decision
                  ? t(known.decision.kind === 'same' ? 'duplicate.checkedSame' : 'duplicate.checkedDifferent')
                  : t('duplicate.alreadyReported')}
              </p>
            )}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t('duplicate.why')}</span>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('duplicate.whyPlaceholder')}
              className={FIELD}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <Button variant="outline" className="cursor-pointer bg-white" onClick={onClose}>
            {t('duplicate.cancel')}
          </Button>
          <Button className="cursor-pointer bg-blue-600 text-white hover:bg-blue-700" disabled={!ready || report.isPending} onClick={send}>
            {report.isPending ? t('duplicate.sending') : t('duplicate.send')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PersonLines({ person }: Readonly<{ person: BdrcPerson }>) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block break-words font-monlam text-base leading-loose text-gray-900">{person.nameBo}</span>
      <span className="block text-xs text-gray-600">
        <span className="font-mono">{person.id}</span>
        {person.dates && <span className="ml-2 font-monlam text-sm leading-loose">{person.dates}</span>}
      </span>
    </span>
  );
}
