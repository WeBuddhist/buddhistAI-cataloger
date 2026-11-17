// What a selection looks like on screen; `useCrossSelection` holds what it does.
import { useContext, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Copy, MessageSquarePlus, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CrossSelection, Marks } from '../hooks/useCrossSelection';
import {
  KEEPS_ESCAPE,
  MARKS_A_SPOT,
  MIN_QUOTE_SYLLABLES,
  noteOnPassage,
  PairNotesContext,
  syllableCount,
  type NewNote,
  type NoteKind,
  type NoteTarget,
  type PairNote,
} from '../notes';
import { NoteDetailTags, NoteForm } from './PairNotes';

/** A short warning over the note form: what is wrong in a few words, and what to do. */
function Warning({ title, children }: Readonly<{ title: string; children?: ReactNode }>) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-0.5 text-xs text-amber-800">{children}</div>}
      </div>
    </div>
  );
}

/** Asked before writing on a passage that already has the person's note. */
function ExistingNoteDialog({
  note,
  canAdd,
  onAdd,
  onNew,
  onCancel,
}: Readonly<{ note: PairNote | undefined; canAdd: boolean; onAdd: () => void; onNew: () => void; onCancel: () => void }>) {
  const { t } = useTranslation();
  return (
    <Dialog open={note != null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md" {...{ [KEEPS_ESCAPE]: '' }}>
        {note && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-left">
                <TriangleAlert className="h-5 w-5 shrink-0 text-amber-600" /> {t('dedup.notes.existingTitle')}
              </DialogTitle>
              <DialogDescription className="text-left">{t('dedup.notes.existingHelp')}</DialogDescription>
            </DialogHeader>
            <div className="rounded-md bg-gray-50 px-3 py-2">
              {note.quote && <blockquote className="mb-1 line-clamp-2 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">{note.quote}</blockquote>}
              <NoteDetailTags note={note} />
              {note.text && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-gray-900">{note.text}</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" className="cursor-pointer" onClick={onCancel}>
                {t('dedup.common.cancel')}
              </Button>
              <Button variant="outline" className="cursor-pointer" onClick={onNew}>
                {t('dedup.notes.writeNew')}
              </Button>
              {canAdd && (
                <Button className="cursor-pointer" onClick={onAdd} autoFocus>
                  {t('dedup.notes.addToMine')}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
  /** Left out where notes cannot be written. May return a promise (storing a recording);
   * the note form stays open until it settles. */
  onAddNote?: (note: NewNote) => Promise<void> | void;
  className?: string;
}>) {
  const { t } = useTranslation();
  const { selected, found, status, step, clear, noting, setNoting, shown } = selection;
  const pairNotes = useContext(PairNotesContext);
  // Set when the person chose to add to the note already on the passage.
  const [adding, setAdding] = useState<string | null>(null);
  // Open while asking what to do about a note already on the passage.
  const [asking, setAsking] = useState(false);
  // The kind chosen in the open form: a note marking a spot may quote just a few syllables.
  const [kind, setKind] = useState<NoteKind | undefined>();
  if (!selected) return null;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('dedup.fullText.copied'));
    } catch {
      toast.error(t('dedup.fullText.copyFailed'));
    }
  };
  const target: NoteTarget = selected.side === 'A' ? 'a' : 'b';
  // "Both" only for a passage found in the other text too (the same words or close).
  const choices: NoteTarget[] = found > 0 ? [target, 'both'] : [target];
  const syllables = syllableCount(selected.text);
  const existing = onAddNote ? noteOnPassage(pairNotes.notes, target, shown[selected.side], selected) : undefined;
  const addingTo = adding && existing?.id === adding && pairNotes.onEdit ? existing : undefined;
  const close = () => {
    setAdding(null);
    setKind(undefined);
    setNoting(false);
  };
  const openForm = (addTo: PairNote | null) => {
    setAdding(addTo?.id ?? null);
    setKind(addTo?.kind);
    setNoting(true);
  };
  const startNote = () => (existing ? setAsking(true) : openForm(null));
  const answer = (addToExisting: boolean) => {
    setAsking(false);
    openForm(addToExisting && existing ? existing : null);
  };
  const tooShort = syllables < MIN_QUOTE_SYLLABLES && kind !== MARKS_A_SPOT;
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
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy(selected.text)}>
            <Copy className="h-4 w-4" /> {t('dedup.fullText.copy')}
          </Button>
          {onAddNote && !noting && (
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={startNote}>
              <MessageSquarePlus className="h-4 w-4" /> {t('dedup.notes.add')}
            </Button>
          )}
          <IconButton
            label={t('dedup.fullText.clearSelection')}
            onClick={() => {
              setAdding(null);
              setKind(undefined);
              clear();
            }}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </span>
      </div>
      {noting && onAddNote && (
        <div className="mt-2">
          <blockquote className="mb-2 line-clamp-2 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">{selected.text}</blockquote>
          {tooShort && !addingTo && (
            <Warning title={t('dedup.notes.shortQuoteTitle', { count: syllables })}>{t('dedup.notes.shortQuoteHelp', { n: MIN_QUOTE_SYLLABLES })}</Warning>
          )}
          {existing && !addingTo && (
            <Warning title={t('dedup.notes.alreadyNoted')}>
              {pairNotes.onEdit && (
                <button type="button" onClick={() => openForm(existing)} className="cursor-pointer font-medium underline underline-offset-2 hover:text-amber-950">
                  {t('dedup.notes.addToThatNote')}
                </button>
              )}
            </Warning>
          )}
          {addingTo && pairNotes.onEdit ? (
            <NoteForm
              key={addingTo.id}
              target={addingTo.target}
              initialText={addingTo.text}
              initialDetails={addingTo}
              onDetailsChange={(d) => setKind(d.kind)}
              onCancel={close}
              onSave={async (edit) => {
                await pairNotes.onEdit?.(addingTo.id, edit);
                setAdding(null);
                setKind(undefined);
                clear();
                toast.success(t('dedup.notes.updated'));
              }}
            />
          ) : (
            <NoteForm
              target={target}
              choices={choices}
              onDetailsChange={(d) => setKind(d.kind)}
              onCancel={close}
              onSave={async (note) => {
                await onAddNote({ ...note, quote: selected.text, range: selected.range });
                setKind(undefined);
                clear();
                toast.success(t('dedup.notes.added'));
              }}
            />
          )}
        </div>
      )}
      <ExistingNoteDialog
        note={asking ? existing : undefined}
        canAdd={pairNotes.onEdit != null}
        onAdd={() => answer(true)}
        onNew={() => answer(false)}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}

/** `text` with `ranges` marked; ranges are in order and do not overlap. */
export function MarkedText({ text, marks, soft = false }: Readonly<{ text: string; marks: Pick<Marks, 'ranges' | 'active' | 'own'>; soft?: boolean }>) {
  const { ranges, active, own } = marks;
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    parts.push(text.slice(at, r.start));
    parts.push(
      <mark key={r.start} data-active={i === active ? '' : undefined} data-own={own} className={`rounded-sm ${i === active && !soft ? 'bg-amber-300' : 'bg-amber-100'}`}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    at = r.end;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}
