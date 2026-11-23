import { useEffect, useState } from 'react';
import { MessageSquarePlus, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { goesAgainst, type NoteEdit, type PairNote } from '../notes';
import { NoteDetailTags, NoteForm, NoteList, type KindGroup } from './PairNotes';

/**
 * The person's notes already on the pair, which are saved with the answer being given:
 * shown before saving it, so none is a surprise. A note whose type goes against the
 * answer (a "same, but…" note on "different") is pointed out, and can be removed.
 */
export function NotesToSave({
  notes,
  verdict,
  onRemove,
}: Readonly<{ notes: PairNote[]; verdict: 'same' | 'different'; onRemove?: (id: string) => void }>) {
  const { t } = useTranslation();
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-gray-600">{t('dedup.answerNotes.savedWith', { count: notes.length })}</h3>
      <ul className="max-h-56 space-y-1.5 overflow-y-auto">
        {notes.map((note) => {
          const against = goesAgainst(note, verdict);
          return (
            <li
              key={note.id}
              className={`flex items-start gap-2 rounded-md px-3 py-2 ${against ? 'border border-amber-300 bg-amber-50' : 'bg-gray-50'}`}
            >
              <div className="min-w-0 flex-1">
                {note.quote && (
                  <blockquote className="mb-1 line-clamp-1 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">{note.quote}</blockquote>
                )}
                <NoteDetailTags note={note} />
                {note.text && <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-gray-900">{note.text}</p>}
                {against && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-800">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> {t(`dedup.answerNotes.against.${verdict}`)}
                  </p>
                )}
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
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Notes on the whole pair, written while answering (no passage selected): offered in the
 * answer's popup before the answer is chosen, so they are not forgotten. They stay here
 * until the answer is saved, and are saved with it. Every type of `group` is offered,
 * those about a place too, without a passage.
 */
export default function AnswerNotes({
  notes,
  group,
  onChange,
  makeNote,
  onWriting,
}: Readonly<{
  notes: PairNote[];
  /** The types that go with the answer: "same, but…" or "different because…". */
  group: KindGroup;
  onChange: (notes: PairNote[]) => void;
  /** Stores the note's recording, if any, and makes the note. */
  makeNote: (edit: NoteEdit) => Promise<PairNote>;
  /** Told while the form is open: the answer waits for the note to be saved or dropped. */
  onWriting: (writing: boolean) => void;
}>) {
  const { t } = useTranslation();
  const [writing, setWriting] = useState(false);
  useEffect(() => onWriting(writing), [writing, onWriting]);

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-gray-300 px-3 py-2">
      {notes.length > 0 && <NoteList notes={notes} onRemove={(id) => onChange(notes.filter((n) => n.id !== id))} />}
      {writing ? (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">{t('dedup.answerNotes.help')}</p>
          <NoteForm
            target="both"
            wholePair
            kindGroup={group}
            saveLabel={t('dedup.answerNotes.save')}
            onCancel={() => setWriting(false)}
            onSave={async (edit) => {
              onChange([...notes, await makeNote(edit)]);
              setWriting(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setWriting(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t(notes.length > 0 ? 'dedup.answerNotes.addAnother' : 'dedup.answerNotes.add')}
        </button>
      )}
    </div>
  );
}
