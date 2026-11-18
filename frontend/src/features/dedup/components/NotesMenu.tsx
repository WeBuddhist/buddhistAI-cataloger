// The pair's notes behind one button, on the pair page and in the full-text window, so
// they can be read and changed without leaving the text.
import { useContext, useEffect, useRef, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { KEEPS_ESCAPE, PairNotesContext, type NotesPlace } from '../notes';
import { NoteList } from './PairNotes';

/** `where`: the texts a note's passage is shown in when its quote is clicked. */
export default function NotesMenu({ where }: Readonly<{ where: NotesPlace }>) {
  const { t } = useTranslation();
  const { notes, onEdit, onRemove, pending, onShow } = useContext(PairNotesContext);
  const [rawOpen, setOpen] = useState(false);
  // The button hides with the last note removed, and the panel closes with it: it must not
  // come back open, on its own, when a note is added later.
  const open = rawOpen && notes.length > 0;
  useEffect(() => {
    if (notes.length === 0) setOpen(false);
  }, [notes.length]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // A menu opened from inside the panel (a note's type, while editing) is drawn outside
    // it: its clicks and its Esc are its own.
    const menuOver = (el: EventTarget | null) =>
      [...document.querySelectorAll(`[${KEEPS_ESCAPE}]`)].some((m) => m !== box.current && (el == null || m.contains(el as Node)));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || menuOver(null)) return;
      e.stopPropagation();
      setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !menuOver(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (notes.length === 0) return null;
  const label = t('dedup.notes.count', { count: notes.length });
  return (
    <div ref={box} className="relative" {...{ [KEEPS_ESCAPE]: open ? '' : undefined }}>
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
      >
        <MessageSquareText className="h-4 w-4" /> {label}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t('dedup.notes.title')}
          // Phones: across the screen, below the top bar; wider screens: under the button.
          className="fixed inset-x-4 top-20 z-[60] flex max-h-[70vh] flex-col sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-[28rem] rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg"
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-medium text-gray-700">{t('dedup.notes.title')}</h3>
            {pending && <span className="text-xs text-gray-500">{t('dedup.notes.savedWithAnswer')}</span>}
          </div>
          <div className="-mx-3 min-h-0 overflow-y-auto px-3">
            <NoteList
              notes={notes}
              onRemove={onRemove}
              onEdit={onEdit}
              onShow={
                onShow &&
                ((note) => {
                  setOpen(false);
                  onShow(note, where);
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
