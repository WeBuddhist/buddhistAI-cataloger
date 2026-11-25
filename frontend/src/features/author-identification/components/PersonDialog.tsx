import { useEffect } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription } from '@/components/ui/dialog';
import { usePrefetchPerson } from '../hooks';
import type { BdrcPerson } from '../types';
import PersonInfobox from './PersonInfobox';
import { bdrcPage } from '../utils';

/** What BDRC knows about a person, with the other results one step away. */
export default function PersonDialog({
  persons,
  index,
  total,
  selectedId,
  onIndexChange,
  onSelect,
  onReport,
  onClose,
}: Readonly<{
  persons: BdrcPerson[];
  /** Which result is open; null when closed. */
  index: number | null;
  total: number;
  selectedId: string | null;
  onIndexChange: (index: number) => void;
  onSelect: (person: BdrcPerson) => void;
  onReport: (person: BdrcPerson) => void;
  onClose: () => void;
}>) {
  const person = index == null ? undefined : persons[index];
  const selected = person != null && person.id === selectedId;

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
        className="flex h-[90dvh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-3xl"
      >
        {person && index != null && (
          <>
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
              <DialogDescription className="min-w-0 flex-1 truncate text-sm text-gray-600">
                Result {index + 1} of {total}
              </DialogDescription>
              <a
                href={bdrcPage(person.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 px-2 text-sm font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
              >
                Open on BDRC <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Button variant="outline" size="icon-sm" aria-label="Previous result" className="cursor-pointer" disabled={index === 0} onClick={() => onIndexChange(index - 1)}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="Next result" className="cursor-pointer" disabled={index >= persons.length - 1} onClick={() => onIndexChange(index + 1)}>
                <ChevronRight />
              </Button>
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close" className="cursor-pointer">
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
                <Copy /> Report duplicate
              </Button>
              <Button variant="outline" className="cursor-pointer" onClick={onClose}>
                Back to results
              </Button>
              <Button className="cursor-pointer bg-blue-600 text-white hover:bg-blue-700" onClick={() => onSelect(person)}>
                {selected && <Check />} {selected ? 'Selected' : 'Select this person'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
