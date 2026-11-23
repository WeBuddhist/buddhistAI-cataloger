import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { givesReason, KEEPS_ESCAPE, type NoteEdit, type PairNote } from '../notes';
import { answerLabel } from '../utils';
import AnswerNotes, { NotesToSave } from './AnswerNotes';
import { NoteForm } from './PairNotes';

/** Why an answer is what it is, asked before saving it; saved as a note on both texts.
 * `different`: a "different" answer with no note saying why, so one of the guidelines'
 * reasons and a sentence. `override`: an adjudicator answering against both annotators,
 * who both gave `annotatorsSaid`, so a sentence (any type). `confirm`: a "different"
 * answer whose reason is already in the notes: every note saved with it (`pairNotes`) is
 * shown once more, with room for other notes on the whole pair (`makeNote`), before
 * `onConfirm` saves the answer. */
export default function DifferentReasonDialog({
  open,
  mode = 'different',
  annotatorsSaid,
  pairNotes = [],
  canRemoveNotes = false,
  onSave,
  onConfirm,
  makeNote,
  onKeepNotes,
  onCancel: cancel,
}: Readonly<{
  open: boolean;
  mode?: 'different' | 'override' | 'confirm';
  annotatorsSaid?: string;
  /** `confirm`: the person's notes already on the pair, saved with the answer. */
  pairNotes?: PairNote[];
  /** Whether `pairNotes` can be removed here: a removal takes effect with the answer, so
   * closing without answering keeps every note. */
  canRemoveNotes?: boolean;
  onSave: (reason: NoteEdit) => Promise<void>;
  /** `confirm`: saves "different", with the notes written here, without those removed here. */
  onConfirm?: (notes: PairNote[], removed: string[]) => Promise<void>;
  makeNote?: (edit: NoteEdit) => Promise<PairNote>;
  /** `confirm` closed without saving: the notes written here are kept on the pair. */
  onKeepNotes?: (notes: PairNote[]) => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation();
  const key = mode === 'override' ? 'dedup.overrideReason' : 'dedup.differentReason';
  const [notes, setNotes] = useState<PairNote[]>([]);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setNotes([]);
      setRemoved([]);
    }
  }, [open]);
  const remove = canRemoveNotes ? (id: string) => setRemoved((r) => [...r, id]) : undefined;
  // Closed without saving: notes written here are kept on the pair, not lost.
  const onCancel = () => {
    if (busy) return;
    if (notes.length > 0) onKeepNotes?.(notes);
    setNotes([]);
    cancel();
  };

  const kept = pairNotes.filter((n) => !removed.includes(n.id));
  // "Different" always needs its reason: removing the last one here blocks saving.
  const reasonLeft = givesReason([...kept, ...notes]);
  const confirm = async () => {
    if (!onConfirm || busy || writing || !reasonLeft) return;
    setBusy(true);
    try {
      await onConfirm(notes, removed);
    } catch {
      // The caller already reported the error; the dialog stays open to retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" {...{ [KEEPS_ESCAPE]: '' }}>
        <DialogHeader>
          <DialogTitle className="text-left">{t(mode === 'confirm' ? 'dedup.differentReason.confirm.title' : `${key}.title`)}</DialogTitle>
          <DialogDescription className="text-left">
            {mode === 'confirm'
              ? t('dedup.differentReason.confirm.help')
              : t(`${key}.help`, { answer: annotatorsSaid ? answerLabel(annotatorsSaid) : '' })}
          </DialogDescription>
        </DialogHeader>
        {open && mode !== 'confirm' && (
          <NoteForm
            target="both"
            onlyGroup={mode === 'different' ? 'different' : undefined}
            requireText={mode === 'override'}
            wholePair
            saveLabel={t(`${key}.save`)}
            onCancel={onCancel}
            onSave={onSave}
          />
        )}
        {open && mode === 'confirm' && (
          <>
            <NotesToSave notes={kept} verdict="different" onRemove={remove} />
            {!reasonLeft && <p className="text-xs font-medium text-red-700">{t('dedup.answerNotes.reasonNeeded')}</p>}
            {makeNote && <AnswerNotes notes={notes} group="different" onChange={setNotes} makeNote={makeNote} onWriting={setWriting} />}
            {writing && <p className="text-xs text-amber-700">{t('dedup.answerNotes.finishFirst')}</p>}
            <DialogFooter className="gap-2">
              <Button variant="outline" className="cursor-pointer" onClick={onCancel} disabled={busy}>
                {t('dedup.common.cancel')}
              </Button>
              <Button className="cursor-pointer" onClick={() => void confirm()} disabled={busy || writing || !reasonLeft}>
                {busy ? t('dedup.common.saving') : t('dedup.differentReason.save')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
