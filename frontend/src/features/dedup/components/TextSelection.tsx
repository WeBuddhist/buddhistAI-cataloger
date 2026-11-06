// What a selection looks like on screen; `useCrossSelection` holds what it does.
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, MessageSquarePlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { CrossSelection, Marks } from '../hooks/useCrossSelection';
import type { NewNote, NoteTarget } from '../notes';
import { NoteForm } from './PairNotes';

export function IconButton({ label, onClick, children }: Readonly<{ label: string; onClick: () => void; children: ReactNode }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="cursor-pointer rounded border border-gray-300 bg-white p-1 text-gray-600 hover:bg-gray-100 disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Shown while something is selected: what the search found, and adding a note on it. */
export function SelectionBar({
  selection,
  onAddNote,
  className = '',
}: Readonly<{
  selection: CrossSelection;
  /** Left out where notes cannot be written. */
  onAddNote?: (note: NewNote) => void;
  className?: string;
}>) {
  const { t } = useTranslation();
  const { selected, found, status, step, clear, noting, setNoting } = selection;
  if (!selected) return null;
  const target: NoteTarget = selected.side === 'A' ? 'a' : 'b';
  return (
    <div className={`bg-gray-50 px-3 py-2 text-sm sm:px-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-700" role="status">{status}</span>
        {found > 1 && (
          <span className="inline-flex gap-1">
            <IconButton label={t('dedup.fullText.previousMatch')} onClick={() => step(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <IconButton label={t('dedup.fullText.nextMatch')} onClick={() => step(1)}>
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          {onAddNote && !noting && (
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setNoting(true)}>
              <MessageSquarePlus className="h-4 w-4" /> {t('dedup.notes.add')}
            </Button>
          )}
          <IconButton label={t('dedup.fullText.clearSelection')} onClick={clear}>
            <X className="h-4 w-4" />
          </IconButton>
        </span>
      </div>
      {noting && onAddNote && (
        <div className="mt-2">
          <blockquote className="mb-2 line-clamp-2 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">{selected.text}</blockquote>
          <NoteForm
            target={target}
            onCancel={() => setNoting(false)}
            onSave={(note) => {
              onAddNote({ ...note, quote: selected.text, range: selected.range });
              clear();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** `text` with `ranges` marked; ranges are in order and do not overlap. */
export function MarkedText({ text, marks, soft = false }: Readonly<{ text: string; marks: Pick<Marks, 'ranges' | 'active'>; soft?: boolean }>) {
  const { ranges, active } = marks;
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    parts.push(text.slice(at, r.start));
    parts.push(
      <mark key={r.start} data-active={i === active ? '' : undefined} className={`rounded-sm ${i === active && !soft ? 'bg-amber-300' : 'bg-amber-100'}`}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    at = r.end;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}
