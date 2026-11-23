import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WitnessCard } from '../api/review';
import { KEEPS_ESCAPE, type NoteEdit, type PairNote } from '../notes';
import { formatNumber } from '../utils';
import AnswerNotes, { NotesToSave } from './AnswerNotes';
import { SourceBadge } from './SourceBadge';

// After "Same work": the plan's preferred access witness (§6.5, Screen 3). Not "which
// reads better", which can reward OCR clean-up. Saved as partner_payload.preferred_mw_id
// (null = no preference). Notes on the whole pair can be added first, above the choices:
// picking a copy saves the answer at once.

export type PreferredChoice = string | null;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  a: WitnessCard;
  b: WitnessCard;
  current?: PreferredChoice;
  /** `notes`: written here, saved with the answer; `removed`: the pair's notes removed here. */
  onPick: (mwId: PreferredChoice, notes: PairNote[], removed: string[]) => Promise<void>;
  /** The person's notes already on the pair, saved with the answer: shown before it. */
  pairNotes?: PairNote[];
  /** Whether `pairNotes` can be removed here: a removal takes effect with the answer, so
   * closing without answering keeps every note. */
  canRemoveNotes?: boolean;
  /** Left out where notes cannot be written. */
  makeNote?: (edit: NoteEdit) => Promise<PairNote>;
  /** Closed without picking: the notes written here are kept on the pair, not lost. */
  onKeepNotes?: (notes: PairNote[]) => void;
};

export default function PreferredCopyDialog({
  open,
  onOpenChange,
  a,
  b,
  current,
  onPick,
  makeNote,
  onKeepNotes,
  pairNotes = [],
  canRemoveNotes = false,
}: Readonly<Props>) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<PairNote[]>([]);
  // The pair's notes removed here: left out of the answer when it is saved; closing
  // without answering keeps them.
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => {
    if (open) setRemoved([]);
  }, [open]);
  const remove = canRemoveNotes ? (id: string) => setRemoved((r) => [...r, id]) : undefined;
  // While a note is being written, a copy cannot be picked: it would save the answer
  // without it.
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (open) setNotes([]);
  }, [open]);
  // Closed without an answer (Cancel, ×, Esc, a click outside).
  const close = () => {
    if (busy) return;
    if (notes.length > 0) onKeepNotes?.(notes);
    setNotes([]);
    onOpenChange(false);
  };

  const pick = async (mwId: PreferredChoice) => {
    if (busy || writing) return;
    setBusy(true);
    try {
      await onPick(mwId, notes, removed);
      onOpenChange(false);
    } catch {
      // The caller already reported the error; keep the dialog open to retry.
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Typing a note: A, B and N are letters, not choices.
      const el = e.target as HTMLElement | null;
      if (writing || el?.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'a') pick(a.mw_id);
      else if (k === 'b') pick(b.mw_id);
      else if (k === 'n') pick(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, a.mw_id, b.mw_id, busy, writing, notes, removed]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" {...{ [KEEPS_ESCAPE]: '' }}>
        <DialogHeader>
          <DialogTitle>{t('dedup.preferred.title')}</DialogTitle>
          <DialogDescription>{t('dedup.preferred.description')}</DialogDescription>
        </DialogHeader>

        <NotesToSave notes={pairNotes.filter((n) => !removed.includes(n.id))} verdict="same" onRemove={remove} />
        {makeNote && <AnswerNotes notes={notes} group="same" onChange={setNotes} makeNote={makeNote} onWriting={setWriting} />}
        {writing && <p className="text-xs text-amber-700">{t('dedup.answerNotes.finishFirst')}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CopyOption tag="A" card={a} selected={current === a.mw_id} disabled={busy || writing} onClick={() => pick(a.mw_id)} />
          <CopyOption tag="B" card={b} selected={current === b.mw_id} disabled={busy || writing} onClick={() => pick(b.mw_id)} />
        </div>

        <button
          onClick={() => pick(null)}
          disabled={busy || writing}
          className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-wait disabled:opacity-60 ${
            current === null ? 'border-gray-800 bg-gray-50' : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
          }`}
        >
          <span>
            <span className="block font-medium text-gray-900">{t('dedup.preferred.noPreference')}</span>
            <span className="block text-xs text-gray-500">{t('dedup.preferred.noPreferenceHelp')}</span>
          </span>
          <Kbd>N</Kbd>
        </button>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={close} disabled={busy}>
            {t('dedup.common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyOption({
  tag,
  card,
  selected,
  disabled,
  onClick,
}: Readonly<{ tag: 'A' | 'B'; card: WitnessCard; selected: boolean; disabled: boolean; onClick: () => void }>) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border p-4 text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${
        selected ? 'border-gray-800 bg-gray-50' : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
      }`}
    >
      <span className="flex items-center justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-gray-100 text-sm font-semibold text-gray-700">
          {tag}
        </span>
        <Kbd>{tag}</Kbd>
      </span>
      <span className="break-words font-monlam text-base leading-relaxed text-gray-900">
        {card.title_bo || <span className="font-sans text-sm italic text-gray-400">{t('dedup.witness.noTitle')}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <SourceBadge source={card.etext_source} />
        <span className="tabular-nums">{t('dedup.witness.characters', { n: formatNumber(card.text_length ?? 0) })}</span>
      </span>
    </button>
  );
}

function Kbd({ children }: Readonly<{ children: string }>) {
  return (
    <kbd className="hidden rounded border border-gray-300 px-1.5 font-mono text-[10px] text-gray-500 sm:inline">
      {children}
    </kbd>
  );
}
