import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KEEPS_ESCAPE, type NoteEdit } from '../notes';
import { NoteForm } from './PairNotes';

/** Asked on a "different" answer that has no note saying why: one of the reasons from the
 * guidelines, and a sentence. It is saved as a note on both texts, with the answer. */
export default function DifferentReasonDialog({
  open,
  onSave,
  onCancel,
}: Readonly<{ open: boolean; onSave: (reason: NoteEdit) => Promise<void>; onCancel: () => void }>) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg" {...{ [KEEPS_ESCAPE]: '' }}>
        <DialogHeader>
          <DialogTitle className="text-left">{t('dedup.differentReason.title')}</DialogTitle>
          <DialogDescription className="text-left">{t('dedup.differentReason.help')}</DialogDescription>
        </DialogHeader>
        {open && (
          <NoteForm
            target="both"
            onlyGroup="different"
            saveLabel={t('dedup.differentReason.save')}
            onCancel={onCancel}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
