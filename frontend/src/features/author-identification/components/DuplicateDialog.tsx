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
import { cleanName, reportOfPair } from '../utils';

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
      toast.success('Duplicate reported', {
        position: 'top-center',
        action: { label: 'Undo', onClick: () => undo.mutate(saved.id) },
      });
    } catch {
      toast.error('Could not send the report. Try again.', { position: 'top-center' });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-xl">
        <div className="border-b border-gray-200 px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold">Report duplicate</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-gray-600">
            For one person who has two BDRC IDs. It will be checked. Nothing changes in BDRC.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <h3 className="mb-1 text-sm font-medium text-gray-700">This person</h3>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <PersonLines person={person} />
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-medium text-gray-700">Is the same as</h3>
            <form onSubmit={find} className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Name of the other person"
                placeholder="Tibetan, Wylie or English"
                className="h-9 flex-1 bg-white font-monlam text-base md:text-base"
              />
              <Button type="submit" variant="outline" className="cursor-pointer bg-white" disabled={!cleanName(query)}>
                <Search /> Find
              </Button>
            </form>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
              {search.isLoading && (
                <p className="flex items-center gap-2 px-3 py-3 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching BDRC…
                </p>
              )}
              {search.isError && <p className="px-3 py-3 text-sm text-red-700">Could not search BDRC. Try again.</p>}
              {!search.isLoading && !search.isError && results.length === 0 && (
                <p className="px-3 py-3 text-sm text-gray-500">Nobody else found. Try another spelling.</p>
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
                  {search.isFetchingNextPage ? 'Loading…' : 'Show more'}
                </button>
              )}
            </div>
            {known && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {known.decision
                  ? `These two were already checked: ${known.decision.kind === 'same' ? 'same person' : 'different people'}.`
                  : 'These two were already reported.'}
              </p>
            )}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Why are they the same person?</span>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: same teacher, same dates, same works"
              className="bg-white"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <Button variant="outline" className="cursor-pointer bg-white" onClick={onClose}>
            Cancel
          </Button>
          <Button className="cursor-pointer bg-blue-600 text-white hover:bg-blue-700" disabled={!ready || report.isPending} onClick={send}>
            {report.isPending ? 'Sending…' : 'Send report'}
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
        <span className="font-mono">{person.id}</span> · {person.dates ?? 'No dates'}
      </span>
    </span>
  );
}
