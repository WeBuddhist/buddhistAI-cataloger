import { History, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DecisionHistory } from '../api/review';
import { notesOf } from '../notes';
import { abstentionLabel, answerLabel, formatDateTime } from '../utils';
import { NoteList } from './PairNotes';

const VERDICT_STYLE: Record<string, string> = {
  same: 'bg-green-50 text-green-700 border-green-200',
  different: 'bg-red-50 text-red-700 border-red-200',
};

// Admin pair screen, above the texts: every answer saved on the pair, newest first, with
// who gave it. The final one (marked) is the answer BDRC has, or is about to get.
export default function AnswerHistory({ history, corrected }: Readonly<{ history: DecisionHistory[]; corrected: boolean }>) {
  const { t } = useTranslation();
  const rows = [...history].reverse();
  // The newest final one; on a double-review pair the annotators' own answers are not final.
  const finalAt = rows.findIndex((d) => d.is_final);
  return (
    <section className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <History className="h-4 w-4 text-indigo-700" />
        <span className="font-medium text-indigo-900">{t('dedup.admin.pair.history')}</span>
        {corrected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
            <ShieldCheck className="h-3.5 w-3.5" /> {t('dedup.admin.pair.correctedBadge')}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-indigo-800/80">{t('dedup.admin.pair.noHistory')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-indigo-100 rounded-md bg-white shadow-sm">
          {rows.map((d, i) => {
            const role = t(`dedup.admin.pair.role.${d.role}`, { defaultValue: d.role });
            const notes = notesOf(d.partner_payload);
            return (
              <li key={`${d.decided_at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    (d.verdict && VERDICT_STYLE[d.verdict]) || 'border-gray-200 bg-gray-50 text-gray-800'
                  }`}
                >
                  {answerLabel(d.verdict)}
                  {d.abstention_reason ? ` · ${abstentionLabel(d.abstention_reason)}` : ''}
                </span>
                <span className="text-gray-900">{d.user_name ?? d.user_id}</span>
                <span className="text-xs text-gray-500">
                  {d.slot != null && d.role === 'annotator' ? `${role} ${d.slot}` : role}
                </span>
                {i === finalAt && (
                  <span className="text-xs font-medium text-green-700">{t('dedup.admin.pair.final')}</span>
                )}
                <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-gray-500">
                  {formatDateTime(d.decided_at)} · {t(`dedup.admin.pair.sync.${d.sync_state}`, { defaultValue: d.sync_state })}
                </span>
                {notes.length > 0 && (
                  <div className="w-full">
                    <NoteList notes={notes} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
