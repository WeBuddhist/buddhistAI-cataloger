import { ArrowRight, Loader2, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AdminPairNote, AdminPairRow } from '../api/review';
import { PlayRecordings } from '../components/PairNotes';
import { useAdminPairNotes } from '../hooks/useReview';
import { formatDateTime } from '../utils';

// Which notes the popup shows: all of them, or one text's.
export type NoteText = 'all' | 'a' | 'b';
const TABS: NoteText[] = ['all', 'a', 'b'];

const ROLE_STYLE: Record<AdminPairNote['role'], string> = {
  annotator: 'bg-gray-100 text-gray-700',
  adjudicator: 'bg-indigo-50 text-indigo-700',
  admin: 'bg-blue-50 text-blue-700',
};

// One text's notes include the ones on both texts (and old note-box notes, about the whole
// pair), so a "both" note shows under either text.
const onText = (n: AdminPairNote, text: NoteText) => text === 'all' || n.target !== (text === 'a' ? 'b' : 'a');

// How many notes each tab shows, worked out from the pair row's counts.
const notesOn = (row: AdminPairRow, text: NoteText) => {
  if (text === 'all') return row.notes_a + row.notes_b + row.notes_both;
  return (text === 'a' ? row.notes_a : row.notes_b) + row.notes_both;
};

// The notes on a pair, from the admin pair list: all of them, or one text's, and a way
// through to the pair itself.
export default function PairNotesDialog({
  row,
  text,
  onText: setText,
  onClose,
  onOpenPair,
}: Readonly<{
  row: AdminPairRow | null;
  text: NoteText;
  onText: (text: NoteText) => void;
  onClose: () => void;
  onOpenPair: (itemId: number) => void;
}>) {
  const { t } = useTranslation();
  const notes = useAdminPairNotes(row?.item_id);
  const shown = (notes.data ?? []).filter((n) => onText(n, text));
  const title = { all: null, a: row?.title_a, b: row?.title_b }[text];

  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-xl">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>{t('dedup.admin.pairs.notesTitle', { id: row.item_id })}</DialogTitle>
              <DialogDescription className="sr-only">{t('dedup.admin.pairs.notesHelp')}</DialogDescription>
            </DialogHeader>

            <div className="flex w-fit rounded-md bg-gray-100 p-0.5 text-sm" role="tablist">
              {TABS.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="tab"
                  aria-selected={text === x}
                  onClick={() => setText(x)}
                  className={`cursor-pointer rounded px-3 py-1 font-medium ${text === x ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {x === 'all' ? t('dedup.admin.pairs.allTab') : t('dedup.admin.pairs.textTab', { text: x.toUpperCase() })}
                  <span className="ml-1.5 tabular-nums text-gray-500">{notesOn(row, x)}</span>
                </button>
              ))}
            </div>
            {title && <p className="-mt-1 break-words font-monlam text-sm text-gray-600">{title}</p>}

            <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
              {notes.isLoading && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-gray-400" />}
              {notes.error && <p className="text-sm text-red-700">{t('dedup.admin.pairs.notesFailed', { error: notes.error.message })}</p>}
              {notes.data && shown.length === 0 && <p className="py-6 text-center text-sm text-gray-500">{t('dedup.admin.pairs.notesEmpty')}</p>}
              <ul className="divide-y divide-gray-100">
                {shown.map((n) => (
                  <NoteItem key={n.id} note={n} />
                ))}
              </ul>
            </div>

            <div className="flex justify-end border-t border-gray-100 pt-3">
              <Button variant="outline" className="cursor-pointer" onClick={() => onOpenPair(row.item_id)}>
                {t('dedup.admin.pairs.openPair')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteItem({ note }: Readonly<{ note: AdminPairNote }>) {
  const { t } = useTranslation();
  const role = note.role === 'annotator' && note.slot ? t('dedup.admin.pairs.annotatorSlot', { n: note.slot }) : t(`dedup.admin.pairs.${note.role}`);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-gray-900">{note.author_name ?? note.author_id}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ROLE_STYLE[note.role]}`}>{role}</span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
          {note.target === 'a' || note.target === 'b' ? t('dedup.admin.pairs.textTab', { text: note.target.toUpperCase() }) : t('dedup.admin.pairs.bothTexts')}
        </span>
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-gray-500">
          {formatDateTime(note.created_at)}
          {note.updated_at && ` · ${t('dedup.notes.edited')}`}
        </span>
      </div>
      <div className="mt-1.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {note.quote && (
            <blockquote className="mb-1 line-clamp-3 border-l-2 border-amber-300 pl-2 font-monlam text-sm text-gray-600">{note.quote}</blockquote>
          )}
          <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{note.text}</p>
        </div>
        {note.voice_note_ids.length > 0 && <PlayRecordings ids={note.voice_note_ids} />}
      </div>
    </li>
  );
}

// The notes icon on a pair's row, with how many notes the pair has; nothing when none.
// Its clicks and keys stay off the row, which opens the pair.
export function NotesButton({ row, onOpen }: Readonly<{ row: AdminPairRow; onOpen: () => void }>) {
  const { t } = useTranslation();
  const n = notesOn(row, 'all');
  if (!n) return null;
  const label = t('dedup.admin.pairs.notesCount', { count: n });
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="mt-0.5 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-800 hover:border-amber-300 hover:bg-amber-100"
    >
      <MessageSquareText className="h-3.5 w-3.5" />
      {n}
    </button>
  );
}
