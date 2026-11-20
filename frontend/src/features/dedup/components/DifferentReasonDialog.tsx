import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KEEPS_ESCAPE, type NoteEdit } from '../notes';
import { answerLabel } from '../utils';
import { NoteForm } from './PairNotes';

/** Why an answer is what it is, asked before saving it; saved as a note on both texts.
 * `different`: a "different" answer with no note saying why, so one of the guidelines'
 * reasons and a sentence. `override`: an adjudicator answering against both annotators,
 * who both gave `annotatorsSaid`, so a sentence (any type). */
export default function DifferentReasonDialog({
  open,
  mode = 'different',
  annotatorsSaid,
  onSave,
  onCancel,
}: Readonly<{
  open: boolean;
  mode?: 'different' | 'override';
  annotatorsSaid?: string;
  onSave: (reason: NoteEdit) => Promise<void>;
  onCancel: () => void;
}>) {
  const { t } = useTranslation();
  const key = mode === 'override' ? 'dedup.overrideReason' : 'dedup.differentReason';
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg" {...{ [KEEPS_ESCAPE]: '' }}>
        <DialogHeader>
          <DialogTitle className="text-left">{t(`${key}.title`)}</DialogTitle>
          <DialogDescription className="text-left">
            {t(`${key}.help`, { answer: annotatorsSaid ? answerLabel(annotatorsSaid) : '' })}
          </DialogDescription>
        </DialogHeader>
        {open && (
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
      </DialogContent>
    </Dialog>
  );
}
