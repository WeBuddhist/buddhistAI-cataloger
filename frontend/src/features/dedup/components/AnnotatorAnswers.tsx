import { useState } from 'react';
import { Check, Flag, Layers, Loader2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { AnnotatorAnswer, WitnessCard } from '../api/review';
import { groupBySamePlace, keptNote, mergedNote, notesOf, type NewNote, type PairNote } from '../notes';
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
  own = [],
  onKeep,
}: Readonly<{
  answers: AnnotatorAnswer[];
  a: WitnessCard;
  b: WitnessCard;
  /** The adjudicator's own notes: those kept from the annotators show as kept. */
  own?: PairNote[];
  /** Keeps an annotator's note (or several as one) in the adjudicator's final notes. Left
   * out where notes cannot be written. */
  onKeep?: (note: NewNote) => Promise<void> | void;
}>) {
  const { t } = useTranslation();
  const bothUnsure = answers.length > 0 && answers.every((x) => x.verdict === 'not_sure');
  // Queued as a final check: both annotators gave the same answer.
  const agreed = answers.length === 2 && !bothUnsure && answers[0].verdict === answers[1].verdict;
  let summary = 'dedup.annotatorAnswers.disagreed';
  if (bothUnsure) summary = 'dedup.annotatorAnswers.bothUnsure';
  else if (agreed) summary = 'dedup.annotatorAnswers.agreedCheck';
  return (
    <section className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Users className="h-4 w-4 text-indigo-700" />
        <span className="font-medium text-indigo-900">{t('dedup.annotatorAnswers.title')}</span>
        <span className="text-indigo-800/80">
          — {t(summary)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {answers.map((ans, i) => (
          <AnswerCard key={ans.label} n={i + 1} answer={ans} a={a} b={b} />
        ))}
      </div>
      <AnnotatorNotes answers={answers} own={own} onKeep={onKeep} />
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
      {/* The notes themselves are listed below the answers, side by side by place. */}
      {notes.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">{t('dedup.annotatorAnswers.notesBelow', { count: notes.length })}</p>
      )}
    </div>
  );
}

/** Both annotators' notes, grouped by the place they are about: two annotators often
 * write the same thing. The adjudicator keeps one note per fact in the final answer; the
 * notes not kept still go to BDRC with each annotator's answer. */
function AnnotatorNotes({
  answers,
  own,
  onKeep,
}: Readonly<{ answers: AnnotatorAnswer[]; own: PairNote[]; onKeep?: (note: NewNote) => Promise<void> | void }>) {
  const { t } = useTranslation();
  const [keeping, setKeeping] = useState<string | null>(null);
  const items = answers.flatMap((ans, i) => notesOf(ans.partner_payload).map((note) => ({ note, n: i + 1 })));
  if (items.length === 0) return null;
  const kept = new Set(own.flatMap((n) => n.adopted_from ?? []));
  const keep = async (key: string, note: NewNote) => {
    if (!onKeep) return;
    setKeeping(key);
    try {
      await onKeep(note);
    } finally {
      setKeeping(null);
    }
  };
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium text-indigo-900">{t('dedup.annotatorAnswers.notesTitle')}</h3>
      {onKeep && <p className="text-xs text-indigo-800/80">{t('dedup.annotatorAnswers.notesHelp')}</p>}
      <div className="mt-2 space-y-2">
        {groupBySamePlace(items).map((group) => {
          const groupKey = group.map((i) => i.note.id).join('+');
          const allKept = group.every((i) => kept.has(i.note.id));
          return (
            <div key={groupKey} className="rounded-md border border-white bg-white px-3 py-2 shadow-sm">
              {group.length > 1 && (
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800">
                    <Layers className="h-3.5 w-3.5" /> {t('dedup.annotatorAnswers.samePlace', { count: group.length })}
                  </span>
                  {onKeep && !allKept && (
                    <Button size="sm" variant="outline" className="h-7 cursor-pointer text-xs" disabled={keeping != null} onClick={() => void keep(groupKey, mergedNote(group.map((i) => i.note)))}>
                      {keeping === groupKey && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {t('dedup.annotatorAnswers.keepAsOne')}
                    </Button>
                  )}
                </div>
              )}
              <ul className="space-y-1.5">
                {group.map(({ note, n }) => (
                  <li key={note.id} className="flex items-start gap-2">
                    <span className="mt-2.5 shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      {t('dedup.annotatorAnswers.annotatorN', { n: formatNumber(n) })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <NoteList notes={[note]} />
                    </div>
                    {kept.has(note.id) ? (
                      <span className="mt-2 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-green-700">
                        <Check className="h-3.5 w-3.5" /> {t('dedup.annotatorAnswers.kept')}
                      </span>
                    ) : (
                      onKeep && (
                        <Button size="sm" variant="outline" className="mt-1 h-7 shrink-0 cursor-pointer text-xs" disabled={keeping != null} onClick={() => void keep(note.id, keptNote(note))}>
                          {keeping === note.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {t('dedup.annotatorAnswers.keep')}
                        </Button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
