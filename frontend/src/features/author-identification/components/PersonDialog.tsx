import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { BdrcPerson } from '../types';
import BdrcFrame from './BdrcFrame';

/** A person's live BDRC page, with the other results one step away. */
export default function PersonDialog({
  persons,
  index,
  total,
  selectedId,
  onIndexChange,
  onSelect,
  onClose,
}: Readonly<{
  persons: BdrcPerson[];
  /** Which result is open; null when closed. */
  index: number | null;
  total: number;
  selectedId: string | null;
  onIndexChange: (index: number) => void;
  onSelect: (person: BdrcPerson) => void;
  onClose: () => void;
}>) {
  const person = index == null ? undefined : persons[index];
  const selected = person != null && person.id === selectedId;

  return (
    <Dialog open={person != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[90dvh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-6xl"
      >
        {person && index != null && (
          <>
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate font-monlam text-lg leading-loose">{person.nameBo}</DialogTitle>
                <DialogDescription className="truncate text-xs text-gray-500">
                  <span className="font-mono">{person.id}</span>
                  {person.dates && ` · ${person.dates}`} · result {index + 1} of {total}
                </DialogDescription>
              </div>
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
            <div className="min-h-0 flex-1">
              <BdrcFrame bdrcId={person.id} title={`BDRC page of ${person.nameBo}`} />
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
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
