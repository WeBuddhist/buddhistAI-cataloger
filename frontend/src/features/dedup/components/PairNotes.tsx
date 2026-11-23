import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, LocateFixed, Mic, Pause, Pencil, Play, SearchCheck, Square, Trash2, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { fetchVoiceNoteUrl, transcribeVoiceNote, type SttRequest } from '../api/review';
import { toWav, useVoiceRecorder } from '../hooks/useVoiceRecorder';
import {
  hasReasonKind,
  KEEPS_ESCAPE,
  kindsOf,
  MIN_QUOTE_SYLLABLES,
  missingPlace,
  NOTE_CHECKS,
  syllableCount,
  NOTE_KINDS,
  recordingIds,
  type NoteDetails,
  type NoteEdit,
  type NoteKind,
  type NoteTarget,
  type PairNote,
} from '../notes';

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

export function NoteList({
  notes,
  onRemove,
  onEdit,
  onShow,
}: Readonly<{
  notes: PairNote[];
  onRemove?: (id: string) => void;
  /** Left out where notes can only be read. Resolves once the edit is stored. */
  onEdit?: (id: string, edit: NoteEdit) => Promise<void> | void;
  /** Shows the note's passage in the text; its quote is a button then. */
  onShow?: (note: PairNote) => void;
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
              {/* An edit keeps the note on its text: whether the passage is in both texts
                  is only known while it is selected. */}
              <NoteForm
                target={note.target}
                quote={note.quote}
                // Made without a passage (in an answer's popup): none can be selected here.
                wholePair={!note.quote}
                initialText={note.text}
                initialDetails={note}
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
            <span className="mt-0.5 shrink-0 rounded bg-gray-200 px-1.5 text-xs font-semibold text-gray-700" title={t('dedup.notes.targetHelp')}>
              {t(`dedup.notes.target.${note.target}`)}
            </span>
            <div className="min-w-0 flex-1">
              {note.quote && onShow && (
                <button
                  type="button"
                  onClick={() => onShow(note)}
                  title={t('dedup.notes.showInText')}
                  className="mb-1 block w-full cursor-pointer rounded-sm border-l-2 border-amber-300 pl-2 text-left hover:border-amber-500 hover:bg-amber-50"
                >
                  <span className="line-clamp-3 font-monlam text-sm text-gray-600">{note.quote}</span>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <LocateFixed className="h-3 w-3" /> {t('dedup.notes.showInText')}
                  </span>
                </button>
              )}
              {note.quote && !onShow && (
                <blockquote className="mb-1 line-clamp-3 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">
                  {note.quote}
                </blockquote>
              )}
              <NoteDetailTags note={note} />
              {note.text && <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{note.text}</p>}
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

/** A note's kinds and what it was checked against, as small tags. Nothing when neither is set. */
export function NoteDetailTags({ note }: Readonly<{ note: NoteDetails }>) {
  const { t } = useTranslation();
  const kinds = kindsOf(note);
  if (kinds.length === 0 && !note.checked) return null;
  let checked = note.checked ? t(`dedup.notes.checked.${note.checked}`) : '';
  if (note.checked === 'scan' && note.page) checked = t('dedup.notes.checked.scanPage', { page: note.page });
  if (note.checked === 'bdrc' && note.witness_id) checked = t('dedup.notes.checked.bdrcFound', { id: note.witness_id });
  return (
    <div className="mb-1 flex flex-wrap gap-1">
      {kinds.map((kind) => (
        <span
          key={kind}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${GROUP_STYLE[groupOf(kind)].tag}`}
          title={t(`dedup.notes.kind.groups.${groupOf(kind)}`)}
        >
          {t(`dedup.notes.kind.options.${kind}.label`)}
        </span>
      ))}
      {note.checked && (
        <span className="inline-flex items-center gap-1 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-700">
          <SearchCheck className="h-3 w-3" /> {checked}
        </span>
      )}
    </div>
  );
}

const FIELD_LABEL = 'text-xs font-medium text-gray-600';

const KIND_GROUPS = Object.keys(NOTE_KINDS) as (keyof typeof NOTE_KINDS)[];

// "Same, but…" in green and "Different because…" in red, as on the Same / Different buttons.
const GROUP_STYLE = {
  same: { text: 'text-green-700', tag: 'bg-green-100 text-green-800', dot: 'bg-green-600', ring: 'border-green-600' },
  different: { text: 'text-red-700', tag: 'bg-red-100 text-red-800', dot: 'bg-red-600', ring: 'border-red-600' },
} as const;

export type KindGroup = keyof typeof NOTE_KINDS;

const groupOf = (kind: NoteKind): KindGroup =>
  (NOTE_KINDS.same as readonly NoteKind[]).includes(kind) ? 'same' : 'different';

/** The chosen types' names (all from one group), after the group, with a dot in its colour. */
function KindLabel({ kinds }: Readonly<{ kinds: NoteKind[] }>) {
  const { t } = useTranslation();
  const group = groupOf(kinds[0]);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${GROUP_STYLE[group].dot}`} aria-hidden />
      <span className="truncate">
        <span className={`font-medium ${GROUP_STYLE[group].text}`}>{t(`dedup.notes.kind.groups.${group}`)} </span>
        {kinds.map((k) => t(`dedup.notes.kind.options.${k}.label`)).join(', ')}
      </span>
    </span>
  );
}

/** The note's kind (from the guidelines) and what it was checked against. */
function DetailFields({
  details,
  onChange,
  onlyGroup,
  required = false,
}: Readonly<{
  details: NoteDetails;
  onChange: (next: NoteDetails) => void;
  /** Only this group's types are offered. */
  onlyGroup?: KindGroup;
  /** A type must be chosen: it cannot be cleared. */
  required?: boolean;
}>) {
  const { t } = useTranslation();
  const kindId = useId();
  const pageId = useId();
  const witnessId = useId();
  // The menu's two steps: first the group (null), then a type from it.
  const [step, setStep] = useState<KindGroup | null>(null);
  // The menu opens where there is more room: the form often sits low on the screen.
  const [side, setSide] = useState<'top' | 'bottom'>('bottom');
  const trigger = useRef<HTMLButtonElement>(null);
  const keepOpen = (e: Event) => e.preventDefault();
  const chosen = kindsOf(details);
  const setKinds = (kinds: NoteKind[]) => onChange({ ...details, kinds, kind: undefined });
  // Ticking a type adds it; one from the other group starts over with it: a note is either
  // "same, but…" or "different because…", not both.
  const toggle = (kind: NoteKind) => {
    if (chosen.includes(kind)) setKinds(chosen.filter((k) => k !== kind));
    else setKinds([...chosen.filter((k) => groupOf(k) === groupOf(kind)), kind]);
  };
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label htmlFor={kindId} className={FIELD_LABEL}>
          {t('dedup.notes.kind.label')}
        </label>
        <div className="flex items-center gap-1">
          <DropdownMenu
            onOpenChange={(open) => {
              // Opens on the chosen type's group, so it can be changed in one click.
              if (!open) return;
              setStep(onlyGroup ?? (chosen.length > 0 ? groupOf(chosen[0]) : null));
              const box = trigger.current?.getBoundingClientRect();
              if (box) setSide(window.innerHeight - box.bottom >= box.top ? 'bottom' : 'top');
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                ref={trigger}
                id={kindId}
                type="button"
                className="flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-xs hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 sm:w-80"
              >
                {chosen.length > 0 ? (
                  <KindLabel kinds={chosen} />
                ) : (
                  <span className="truncate text-gray-500">
                    {t(required ? 'dedup.notes.kind.placeholderRequired' : 'dedup.notes.kind.placeholder')}
                  </span>
                )}
                <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            {/* Over the full-text window, which leaves Esc to it while it is open. */}
            <DropdownMenuContent
              align="start"
              side={side}
              collisionPadding={8}
              className="z-[60] w-[var(--radix-dropdown-menu-trigger-width)] min-w-[min(20rem,calc(100vw-1rem))] max-h-[min(var(--radix-dropdown-menu-content-available-height),26rem)]"
              {...{ [KEEPS_ESCAPE]: '' }}
            >
              {step === null &&
                KIND_GROUPS.map((g) => (
                  <DropdownMenuItem key={g} onSelect={(e) => { keepOpen(e); setStep(g); }} className="cursor-pointer items-start py-2.5">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${GROUP_STYLE[g].dot}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`block font-medium ${GROUP_STYLE[g].text}`}>{t(`dedup.notes.kind.groups.${g}`)}</span>
                      <span className="block text-xs text-gray-500">{t(`dedup.notes.kind.groupHelp.${g}`)}</span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 text-gray-400" />
                  </DropdownMenuItem>
                ))}
              {step !== null && (
                <>
                  {/* Limited to one group, there is no going back to choose another. */}
                  {onlyGroup ? (
                    <div className={`px-2 py-1.5 text-sm font-semibold ${GROUP_STYLE[step].text}`}>{t(`dedup.notes.kind.groups.${step}`)}</div>
                  ) : (
                    <DropdownMenuItem onSelect={(e) => { keepOpen(e); setStep(null); }} className={`cursor-pointer font-semibold ${GROUP_STYLE[step].text}`}>
                      <ChevronLeft className="h-4 w-4" />
                      {t(`dedup.notes.kind.groups.${step}`)}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {NOTE_KINDS[step].map((kind) => {
                    const on = chosen.includes(kind);
                    const box = on ? `${GROUP_STYLE[step].ring} ${GROUP_STYLE[step].dot}` : 'border-gray-300';
                    return (
                      // Several types per note: a checkbox for each, and the menu stays open.
                      <DropdownMenuItem
                        key={kind}
                        role="menuitemcheckbox"
                        aria-checked={on}
                        onSelect={(e) => {
                          keepOpen(e);
                          toggle(kind);
                        }}
                        className="cursor-pointer items-start py-2"
                      >
                        <span
                          aria-hidden
                          // A square with small corners: the theme's `rounded` turns a box this size into a circle.
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-2 ${box}`}
                        >
                          {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                        </span>
                        {/* The meaning shows with each type: touch screens have no hover. */}
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-gray-900">{t(`dedup.notes.kind.options.${kind}.label`)}</span>
                          <span className="block text-xs leading-snug text-gray-500">{t(`dedup.notes.kind.options.${kind}.help`)}</span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {chosen.length > 0 && !required && (
            <button
              type="button"
              onClick={() => setKinds([])}
              aria-label={t('dedup.notes.kind.clear')}
              title={t('dedup.notes.kind.clear')}
              className={ICON_BUTTON}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {chosen.length === 1 && <p className="text-xs text-gray-500">{t(`dedup.notes.kind.options.${chosen[0]}.help`)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={FIELD_LABEL} id={`${kindId}-checked`}>
          {t('dedup.notes.checked.label')}
        </span>
        <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5" role="radiogroup" aria-labelledby={`${kindId}-checked`}>
          {NOTE_CHECKS.map((check) => (
            <button
              key={check}
              type="button"
              role="radio"
              aria-checked={details.checked === check}
              // Clicking the chosen one again leaves it unanswered.
              onClick={() => onChange({ ...details, checked: details.checked === check ? undefined : check })}
              className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                details.checked === check ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t(`dedup.notes.checked.${check}`)}
            </button>
          ))}
        </div>
        {details.checked === 'scan' && (
          <span className="inline-flex items-center gap-1.5">
            <label htmlFor={pageId} className={FIELD_LABEL}>
              {t('dedup.notes.checked.page')}
            </label>
            <input
              id={pageId}
              value={details.page ?? ''}
              onChange={(e) => onChange({ ...details, page: e.target.value })}
              maxLength={20}
              placeholder={t('dedup.notes.checked.pagePlaceholder')}
              className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </span>
        )}
        {details.checked === 'bdrc' && (
          <span className="inline-flex items-center gap-1.5">
            <label htmlFor={witnessId} className={FIELD_LABEL}>
              {t('dedup.notes.checked.found')}
            </label>
            {/* A pasted library link is fine: the id is taken from it when saved. */}
            <input
              id={witnessId}
              value={details.witness_id ?? ''}
              onChange={(e) => onChange({ ...details, witness_id: e.target.value })}
              maxLength={200}
              placeholder={t('dedup.notes.checked.foundPlaceholder')}
              title={t('dedup.notes.checked.foundHelp')}
              className="w-36 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** The text of a note on a selected passage, typed or spoken. A spoken note keeps its
 * recordings (joined into one) to be stored with the note when it is saved. */
export function NoteForm({
  target,
  choices = [target],
  initialText = '',
  initialDetails,
  onDetailsChange,
  onlyGroup,
  kindGroup,
  requireText = false,
  wholePair = false,
  quote,
  saveLabel,
  onSave,
  onCancel,
}: Readonly<{
  /** The passage the note is on, if any: a kind about a place needs one. */
  quote?: string;
  /** The side the note starts on. */
  target: NoteTarget;
  /** The sides it may be on: for a new note, the selected side, and both when the passage
   * is in the other text too. Just `target` by default. */
  choices?: NoteTarget[];
  /** The saved text, when editing a note. */
  initialText?: string;
  /** The saved kind and check, when editing a note. */
  initialDetails?: NoteDetails;
  /** Told when the kind or check changes. */
  onDetailsChange?: (details: NoteDetails) => void;
  /** A type from this group must be chosen (the reason for a "different" answer). */
  onlyGroup?: KindGroup;
  /** Only this group's types are offered, but none has to be chosen (a note made while
   * answering, which matches the answer). */
  kindGroup?: KindGroup;
  /** A sentence must be written, whatever the type (explaining an answer). */
  requireText?: boolean;
  /** A note about the whole pair, made while answering: no passage can be selected for
   * it, so a kind about a place does not ask for one. */
  wholePair?: boolean;
  /** In place of "Save note". */
  saveLabel?: string;
  /** May return a promise; the form stays open (and Save disabled) until it settles. */
  onSave: (note: NoteEdit) => Promise<void> | void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<NoteTarget>(target);
  // "Both" may have been chosen before the choices changed.
  const side = choices.includes(chosen) ? chosen : target;
  const [details, setDetails] = useState<NoteDetails>({
    kinds: initialDetails ? kindsOf(initialDetails) : [],
    checked: initialDetails?.checked,
    page: initialDetails?.page,
    witness_id: initialDetails?.witness_id,
  });
  const changeDetails = (next: NoteDetails) => {
    setDetails(next);
    onDetailsChange?.(next);
  };
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

  // A reason for "different" needs a sentence: the type alone does not say why.
  const kinds = kindsOf(details);
  const needsSentence = requireText || hasReasonKind(kinds);
  // A kind about a place needs a passage (no sentence); a short one is asked about first.
  const placeMissing = wholePair ? null : missingPlace(kinds, quote);
  const canSave =
    (onlyGroup ? kinds.length > 0 && Boolean(text.trim()) : Boolean(text.trim() || kinds.length > 0) && !(needsSentence && !text.trim())) &&
    placeMissing !== 'none';
  const [askingShort, setAskingShort] = useState(false);

  const save = async (anyway = false) => {
    if (placeMissing === 'short' && !anyway) {
      setAskingShort(true);
      return;
    }
    setAskingShort(false);
    const recording = clips.length > 0
      ? { audio: toWav(clips.map((c) => c.samples)), stt: clips.map((c) => c.stt) }
      : undefined;
    setSaving(true);
    try {
      await onSave({ target: side, text: text.trim(), ...details, recording });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {choices.length > 1 && (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5" role="radiogroup" aria-label={t('dedup.notes.targetLabel')}>
        {choices.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={side === key}
            onClick={() => setChosen(key)}
            className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              side === key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t(`dedup.notes.target.${key}`)}
          </button>
        ))}
      </div>
      <span className="text-xs text-gray-500">{t('dedup.notes.targetHelp')}</span>
      </div>
      )}
      <DetailFields details={details} onChange={changeDetails} onlyGroup={onlyGroup ?? kindGroup} required={onlyGroup != null} />
      <Textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t(needsSentence ? 'dedup.notes.placeholderWhy' : 'dedup.notes.placeholder')}
        maxLength={MAX_LENGTH}
        autoFocus
        className="min-h-[64px] bg-white text-sm"
      />
      {hasReasonKind(kinds) && !text.trim() && <p className="text-xs text-red-700">{t('dedup.notes.whyRequired')}</p>}
      {placeMissing === 'none' && <p className="text-xs text-red-700">{t('dedup.notes.placeRequired')}</p>}
      <Dialog open={askingShort} onOpenChange={setAskingShort}>
        <DialogContent className="sm:max-w-md" {...{ [KEEPS_ESCAPE]: '' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-left">
              <TriangleAlert className="h-5 w-5 shrink-0 text-amber-600" />
              {t('dedup.notes.shortQuoteTitle', { count: syllableCount(quote ?? '') })}
            </DialogTitle>
            <DialogDescription className="text-left">{t('dedup.notes.shortPlaceHelp', { n: MIN_QUOTE_SYLLABLES })}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="cursor-pointer" onClick={() => void save(true)}>
              {t('dedup.notes.saveAnyway')}
            </Button>
            <Button className="cursor-pointer" onClick={() => setAskingShort(false)} autoFocus>
              {t('dedup.notes.selectMore')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        <Button size="sm" className="cursor-pointer" onClick={() => void save()} disabled={!canSave || busy || saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saveLabel ?? t('dedup.notes.save')}
        </Button>
      </div>
    </div>
  );
}
