import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, MessageSquareText, Mic, Pause, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fetchVoiceNoteUrl, transcribeVoiceNote, type SttRequest } from '../api/review';
import { toWav, useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { recordingIds, type NoteEdit, type NoteTarget, type PairNote } from '../notes';

const MAX_LENGTH = 2000;

/** Plays a spoken note's recordings one after another, each from a short-lived S3 link. */
export function PlayRecordings({ ids }: Readonly<{ ids: string[] }>) {
  const { t } = useTranslation();
  const player = useRef<HTMLAudioElement | null>(null);
  // Bumped on every start and stop, so a sequence that was stopped does not carry on.
  const run = useRef(0);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');

  useEffect(() => () => {
    run.current += 1;
    player.current?.pause();
  }, []);

  const stopAll = () => {
    run.current += 1;
    player.current?.pause();
    setState('idle');
  };

  const playFrom = async (index: number, myRun: number) => {
    if (myRun !== run.current) return;
    if (index >= ids.length) {
      setState('idle');
      return;
    }
    setState('loading');
    try {
      // A fresh link each time: they expire after a few minutes.
      const audio = new Audio(await fetchVoiceNoteUrl(ids[index]));
      if (myRun !== run.current) return;
      player.current = audio;
      audio.onended = () => void playFrom(index + 1, myRun);
      await audio.play();
      setState('playing');
    } catch (err) {
      if (myRun !== run.current) return;
      setState('idle');
      toast.error(t('dedup.notes.voice.playFailed'), { description: err instanceof Error ? err.message : undefined });
    }
  };

  const click = () => {
    if (state !== 'idle') {
      stopAll();
      return;
    }
    run.current += 1;
    void playFrom(0, run.current);
  };

  let label = ids.length > 1 ? t('dedup.notes.voice.playMany', { count: ids.length }) : t('dedup.notes.voice.play');
  if (state !== 'idle') label = t('dedup.notes.voice.pause');
  return (
    <button
      type="button"
      onClick={click}
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
    >
      {state === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {state === 'playing' && <Pause className="h-3.5 w-3.5" />}
      {state === 'idle' && <Play className="h-3.5 w-3.5" />}
      {ids.length > 1 && <span className="text-[11px] tabular-nums">{ids.length}</span>}
    </button>
  );
}

const ICON_BUTTON = 'shrink-0 cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700';

/** The side choices for a note: its own side and both; a note already on both keeps it. */
function choicesFor(target: NoteTarget): NoteTarget[] {
  return target === 'both' ? ['both'] : [target, 'both'];
}

export function NoteList({
  notes,
  onRemove,
  onEdit,
}: Readonly<{
  notes: PairNote[];
  onRemove?: (id: string) => void;
  /** Left out where notes can only be read. Resolves once the edit is stored. */
  onEdit?: (id: string, edit: NoteEdit) => Promise<void> | void;
}>) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <ul className="space-y-2">
      {notes.map((note) => {
        const ids = recordingIds(note);
        if (editing === note.id && onEdit) {
          return (
            <li key={note.id} className="rounded-md bg-gray-50 px-3 py-2">
              {note.quote && (
                <blockquote className="mb-2 line-clamp-3 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">
                  {note.quote}
                </blockquote>
              )}
              <NoteForm
                target={note.target}
                choices={choicesFor(note.target)}
                initialText={note.text}
                onCancel={() => setEditing(null)}
                onSave={async (edit) => {
                  await onEdit(note.id, edit);
                  setEditing(null);
                }}
              />
            </li>
          );
        }
        return (
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
              {note.updated_at && <p className="mt-0.5 text-[11px] text-gray-400">{t('dedup.notes.edited')}</p>}
            </div>
            {ids.length > 0 && <PlayRecordings ids={ids} />}
            {onEdit && (
              <button
                type="button"
                onClick={() => setEditing(note.id)}
                aria-label={t('dedup.notes.edit')}
                title={t('dedup.notes.edit')}
                className={ICON_BUTTON}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(note.id)}
                aria-label={t('dedup.notes.remove')}
                title={t('dedup.notes.remove')}
                className={ICON_BUTTON}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface Spoken {
  text: string;
  samples: Float32Array;
  stt: SttRequest;
}

/** Mic button: records, then hands back the transcript and the recording. Nothing is
 * stored until the user has corrected the text in the note box and pressed Save. */
function VoiceButton({
  onSpoken,
  onBusy,
  disabled,
}: Readonly<{ onSpoken: (spoken: Spoken) => void; onBusy: (busy: boolean) => void; disabled?: boolean }>) {
  const { t } = useTranslation();
  const { recording, start, stop } = useVoiceRecorder();
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => onBusy(recording || transcribing), [recording, transcribing, onBusy]);

  const click = async () => {
    if (!recording) {
      try {
        await start();
      } catch {
        toast.error(t('dedup.notes.voice.micBlocked'));
      }
      return;
    }
    const samples = stop();
    if (!samples) return;
    setTranscribing(true);
    try {
      const { text, request_id, model_id } = await transcribeVoiceNote(toWav([samples]));
      if (text) onSpoken({ text, samples, stt: { request_id, model_id } });
      else toast.info(t('dedup.notes.voice.nothingHeard'));
    } catch (err) {
      toast.error(t('dedup.notes.voice.failed'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setTranscribing(false);
    }
  };

  let label = t('dedup.notes.voice.record');
  let icon = <Mic className="h-4 w-4" />;
  if (transcribing) {
    label = t('dedup.notes.voice.transcribing');
    icon = <Loader2 className="h-4 w-4 animate-spin" />;
  } else if (recording) {
    label = t('dedup.notes.voice.stop');
    icon = <Square className="h-4 w-4" />;
  }
  return (
    <Button
      size="sm"
      variant={recording ? 'destructive' : 'outline'}
      onClick={click}
      disabled={disabled || transcribing}
      title={label}
      aria-label={label}
      className="mr-auto cursor-pointer"
    >
      {icon}
      {(recording || transcribing) && <span className="text-xs">{label}</span>}
    </Button>
  );
}

/** The text of a note on a selected passage, typed or spoken. A spoken note keeps its
 * recordings (joined into one) to be stored with the note when it is saved. */
export function NoteForm({
  target,
  choices = choicesFor(target),
  initialText = '',
  onSave,
  onCancel,
}: Readonly<{
  /** The side the note starts on. */
  target: NoteTarget;
  /** The sides it may be on: the selected side and both, for a new note. */
  choices?: NoteTarget[];
  /** The saved text, when editing a note. */
  initialText?: string;
  /** May return a promise; the form stays open (and Save disabled) until it settles. */
  onSave: (note: NoteEdit) => Promise<void> | void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<NoteTarget>(target);
  const [text, setText] = useState(initialText);
  const [clips, setClips] = useState<Spoken[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Where to put the cursor once the inserted text is on screen.
  const caretAfterInsert = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const caret = caretAfterInsert.current;
    if (el && caret != null) {
      caretAfterInsert.current = null;
      el.focus();
      el.setSelectionRange(caret, caret);
    }
  }, [text]);

  /** Puts spoken text where the cursor is (replacing any selected text); at the end if
   * the box was never clicked. Spaces are added so it does not run into its neighbours. */
  const insertSpoken = (spoken: string) => {
    const el = box.current;
    const current = el?.value ?? text;
    const start = el ? el.selectionStart : current.length;
    const end = el ? el.selectionEnd : current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    const inserted = `${lead}${spoken}${trail}`;
    const next = `${before}${inserted}${after}`.slice(0, MAX_LENGTH);
    caretAfterInsert.current = Math.min(before.length + lead.length + spoken.length, next.length);
    setText(next);
  };

  const save = async () => {
    const recording = clips.length > 0
      ? { audio: toWav(clips.map((c) => c.samples)), stt: clips.map((c) => c.stt) }
      : undefined;
    setSaving(true);
    try {
      await onSave({ target: chosen, text: text.trim(), recording });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {choices.length > 1 && (
      <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5" role="radiogroup" aria-label={t('dedup.notes.targetLabel')}>
        {choices.map((key) => (
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
      )}
      <Textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('dedup.notes.placeholder')}
        maxLength={MAX_LENGTH}
        autoFocus
        className="min-h-[64px] bg-white text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <VoiceButton
          disabled={text.length >= MAX_LENGTH}
          onBusy={setBusy}
          onSpoken={(spoken) => {
            setClips((prev) => [...prev, spoken]);
            insertSpoken(spoken.text);
          }}
        />
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={onCancel} disabled={saving}>
          {t('dedup.common.cancel')}
        </Button>
        <Button size="sm" className="cursor-pointer" onClick={save} disabled={!text.trim() || busy || saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
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
  onEdit,
  pending = false,
}: Readonly<{
  notes: PairNote[];
  /** Left out where the notes can only be read (a locked pair, an admin looking at one). */
  onRemove?: (id: string) => void;
  /** Left out where the notes can only be read. */
  onEdit?: (id: string, edit: NoteEdit) => Promise<void> | void;
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
      <NoteList notes={notes} onRemove={onRemove} onEdit={onEdit} />
    </section>
  );
}
