import { useState } from 'react';
import { MessageSquareText, Mic, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { NewNote, NoteTarget, PairNote } from '../notes';

const MAX_LENGTH = 2000;

export function NoteList({ notes, onRemove }: Readonly<{ notes: PairNote[]; onRemove?: (id: string) => void }>) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-2">
      {notes.map((note) => (
        <li key={note.id} className="flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2">
          <span className="mt-0.5 shrink-0 rounded bg-gray-200 px-1.5 text-xs font-semibold text-gray-700">
            {t(`dedup.notes.target.${note.target}`)}
          </span>
          <div className="min-w-0 flex-1">
            {note.quote && (
              <blockquote className="mb-1 line-clamp-3 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">
                {note.quote}
              </blockquote>
            )}
            <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{note.text}</p>
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(note.id)}
              aria-label={t('dedup.notes.remove')}
              title={t('dedup.notes.remove')}
              className="shrink-0 cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The text of a note on a selected passage. Voice joins typing here once STT is in. */
export function NoteForm({
  target,
  onSave,
  onCancel,
}: Readonly<{
  /** The selected side, which the note starts on; it can also be on both. */
  target: NoteTarget;
  onSave: (note: Pick<NewNote, 'target' | 'text'>) => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<NoteTarget>(target);
  const [text, setText] = useState('');
  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5" role="radiogroup" aria-label={t('dedup.notes.targetLabel')}>
        {[target, 'both' as const].map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={chosen === key}
            onClick={() => setChosen(key)}
            className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              chosen === key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t(`dedup.notes.target.${key}`)}
          </button>
        ))}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('dedup.notes.placeholder')}
        maxLength={MAX_LENGTH}
        autoFocus
        className="min-h-[64px] bg-white text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled
          title={t('dedup.notes.voiceLater')}
          aria-label={t('dedup.notes.voiceLater')}
          className="mr-auto"
        >
          <Mic className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={onCancel}>
          {t('dedup.common.cancel')}
        </Button>
        <Button size="sm" className="cursor-pointer" onClick={() => onSave({ target: chosen, text: text.trim() })} disabled={!text.trim()}>
          {t('dedup.notes.save')}
        </Button>
      </div>
    </div>
  );
}

// The pair's notes, on the answer screens. Notes are added by selecting text.
export default function PairNotes({
  notes,
  onRemove,
  pending = false,
}: Readonly<{
  notes: PairNote[];
  /** Left out where the notes can only be read (a locked pair, an admin looking at one). */
  onRemove?: (id: string) => void;
  /** Nothing to save onto yet: the notes go with the answer. */
  pending?: boolean;
}>) {
  const { t } = useTranslation();
  if (notes.length === 0) return null;
  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <MessageSquareText className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-medium text-gray-700">{t('dedup.notes.title')}</h3>
        {pending && <span className="text-xs text-gray-500">{t('dedup.notes.savedWithAnswer')}</span>}
      </div>
      <NoteList notes={notes} onRemove={onRemove} />
    </section>
  );
}
