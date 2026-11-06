import { Flag, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnnotatorAnswer, WitnessCard } from '../api/review';
import { notesOf } from '../notes';
import { abstentionLabel, answerLabel, formatNumber, issueLabel } from '../utils';
import { NoteList } from './PairNotes';

const VERDICT_STYLE: Record<string, string> = {
  same: 'bg-green-50 text-green-700 border-green-200',
  different: 'bg-red-50 text-red-700 border-red-200',
};

// Shown to the adjudicator above the texts: why the pair is here. The answers are
// unnamed and in a shuffled order, so the decision rests on the texts, not on who gave them.
export default function AnnotatorAnswers({
  answers,
  a,
  b,
}: Readonly<{ answers: AnnotatorAnswer[]; a: WitnessCard; b: WitnessCard }>) {
  const { t } = useTranslation();
  const bothUnsure = answers.length > 0 && answers.every((x) => x.verdict === 'not_sure');
  return (
    <section className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Users className="h-4 w-4 text-indigo-700" />
        <span className="font-medium text-indigo-900">{t('dedup.annotatorAnswers.title')}</span>
        <span className="text-indigo-800/80">
          — {t(bothUnsure ? 'dedup.annotatorAnswers.bothUnsure' : 'dedup.annotatorAnswers.disagreed')}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {answers.map((ans, i) => (
          <AnswerCard key={ans.label} n={i + 1} answer={ans} a={a} b={b} />
        ))}
      </div>
    </section>
  );
}

// `n`: the answer's place in the shuffled order ("Annotator 1" / "Annotator 2").
function AnswerCard({ n, answer, a, b }: Readonly<{ n: number; answer: AnnotatorAnswer; a: WitnessCard; b: WitnessCard }>) {
  const { t } = useTranslation();
  const preferred = answer.partner_payload?.preferred_mw_id as string | null | undefined;
  const notes = notesOf(answer.partner_payload);
  let preferredNote: string | null = null;
  if (answer.verdict === 'same' && preferred !== undefined) {
    if (preferred === null) preferredNote = t('dedup.annotatorAnswers.noPreferredCopy');
    else if (preferred === a.mw_id) preferredNote = t('dedup.annotatorAnswers.aBetter');
    else if (preferred === b.mw_id) preferredNote = t('dedup.annotatorAnswers.bBetter');
  }
  return (
    <div className="rounded-md border border-white bg-white px-3 py-2.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('dedup.annotatorAnswers.annotatorN', { n: formatNumber(n) })}
        </span>
        {answer.confidence != null && (
          <span className="text-xs tabular-nums text-gray-500" title={t('dedup.annotatorAnswers.confidenceTitle')}>
            {t('dedup.annotatorAnswers.confidence', { n: formatNumber(answer.confidence) })}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-sm font-medium ${
            (answer.verdict && VERDICT_STYLE[answer.verdict]) || 'border-gray-200 bg-gray-50 text-gray-800'
          }`}
        >
          {answerLabel(answer.verdict)}
        </span>
        {answer.abstention_reason && (
          <span className="text-sm text-gray-600">
            {abstentionLabel(answer.abstention_reason)}
          </span>
        )}
        {preferredNote && <span className="text-sm text-gray-600">· {preferredNote}</span>}
      </div>
      {answer.issues && answer.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {answer.issues.map((i, n) => (
            <li key={`${i.kind}-${n}`} className="flex items-start gap-1.5 text-xs text-amber-800">
              <Flag className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {issueLabel(i.kind)}
                {i.note ? <span className="text-amber-700/80"> — {i.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <div className="mt-2">
          <NoteList notes={notes} />
        </div>
      )}
    </div>
  );
}
