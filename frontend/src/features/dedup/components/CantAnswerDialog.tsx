import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { DecisionInput, ReviewIssue, ReviewItem } from '../api/review';
import { hasIssue, issueLabel, verdictLabel } from '../utils';

// Values from the review plan (§5 decision / issue, §10 abstention reasons):
//   answer -> a verdict about the pair ("not_sure" + an abstention_reason for "can't answer")
//   issue  -> a data problem reported alongside the verdict, never instead of it
// Labels and help texts: dedup.cantAnswer.* in the translation files, by these keys.
type Answer = { key: string; fields: DecisionInput };
type IssueOption = { kind: string; needsNote?: boolean };

export type CantAnswerStart = 'default' | 'issue';

// Space = can't answer, which can also carry a data problem; X flags one on its own.
const ANSWER_GROUPS: { mode: CantAnswerStart; answers: Answer[] }[] = [
  {
    mode: 'default',
    answers: [
      {
        key: 'insufficient_evidence',
        fields: { verdict: 'not_sure', abstention_reason: 'insufficient_evidence' },
      },
      {
        key: 'genuinely_ambiguous',
        fields: { verdict: 'not_sure', abstention_reason: 'genuinely_ambiguous' },
      },
      {
        key: 'needs_image_or_metadata',
        fields: { verdict: 'not_sure', abstention_reason: 'needs_image_or_metadata' },
      },
      {
        key: 'technical_failure',
        fields: { verdict: 'not_sure', abstention_reason: 'technical_failure' },
      },
      {
        key: 'out_of_scope',
        fields: { verdict: 'not_sure', abstention_reason: 'out_of_scope' },
      },
    ],
  },
];

const ISSUES: IssueOption[] = [
  { kind: 'outline_issue' },
  { kind: 'author_conflict' },
  { kind: 'wrong_author' },
  { kind: 'undersegmented' },
  { kind: 'oversegmented' },
  { kind: 'convention' },
  { kind: 'anthology_suspected' },
  { kind: 'source_dup' },
  { kind: 'other', needsNote: true },
];

type Which = 'both' | 'a' | 'b';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Pick<ReviewItem, 'subject' | 'issues' | 'verdict'>;
  start: CantAnswerStart;
  onSubmit: (fields: DecisionInput) => Promise<void>;
}

export default function CantAnswerDialog({ open, onOpenChange, item, start, onSubmit }: Props) {
  const { t } = useTranslation();
  const group = start === 'issue' ? null : (ANSWER_GROUPS.find((g) => g.mode === start) ?? ANSWER_GROUPS[1]);
  const initialAnswer = group?.answers[0].key ?? '';
  const [answerKey, setAnswerKey] = useState(initialAnswer);
  // In the answer dialogs the data problem is optional and starts collapsed.
  const [reporting, setReporting] = useState(start === 'issue');
  const [issueKind, setIssueKind] = useState(ISSUES[0].kind);
  const [which, setWhich] = useState<Which>('both');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAnswerKey(initialAnswer);
      setReporting(start === 'issue');
      setIssueKind(ISSUES[0].kind);
      setWhich('both');
      setNote('');
    }
  }, [open, initialAnswer, start]);

  const answer = group?.answers.find((a) => a.key === answerKey) ?? group?.answers[0];
  const issue = ISSUES.find((i) => i.kind === issueKind) ?? ISSUES[0];
  const noteMissing = reporting && Boolean(issue.needsNote) && !note.trim();

  const newIssue = (): ReviewIssue => {
    const { a_mw, b_mw } = item.subject;
    let ids = [a_mw, b_mw];
    if (which === 'a') ids = [a_mw];
    else if (which === 'b') ids = [b_mw];
    return { kind: issueKind, mw_ids: ids.filter((x): x is string => Boolean(x)), note: note.trim() || null };
  };

  const submit = async () => {
    setBusy(true);
    try {
      const issues = reporting ? { issues: [...(item.issues ?? []), newIssue()] } : {};
      // Without an answer group this only adds the problem; any saved verdict stays.
      await onSubmit(answer ? { ...answer.fields, ...issues } : issues);
      onOpenChange(false);
    } catch {
      // The caller already reported the error; keep the dialog open to retry.
    } finally {
      setBusy(false);
    }
  };

  const issueForm = (
    <div className="space-y-3">
      {group && (
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">{t('dedup.cantAnswer.problem')}</span>
          <select
            value={issueKind}
            onChange={(e) => setIssueKind(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {ISSUES.map((i) => (
              <option key={i.kind} value={i.kind}>
                {issueLabel(i.kind)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-gray-500">{t(`dedup.cantAnswer.issueHelp.${issue.kind}`)}</span>
        </label>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-gray-600">{t('dedup.cantAnswer.whichText')}</span>
        <select
          value={which}
          onChange={(e) => setWhich(e.target.value as Which)}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="both">{t('dedup.cantAnswer.both')}</option>
          <option value="a">{t('dedup.cantAnswer.aOnly')}</option>
          <option value="b">{t('dedup.cantAnswer.bOnly')}</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-gray-600">{t(issue.needsNote ? 'dedup.cantAnswer.noteRequired' : 'dedup.cantAnswer.noteOptional')}</span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </label>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {group ? t(`dedup.cantAnswer.group.${group.mode}.title`) : t('dedup.cantAnswer.reportTitle')}
          </DialogTitle>
          <DialogDescription>
            {group
              ? t(`dedup.cantAnswer.group.${group.mode}.description`)
              : t(item.verdict ? 'dedup.cantAnswer.reportDescriptionWithAnswer' : 'dedup.cantAnswer.reportDescription', {
                  answer: item.verdict ? verdictLabel(item.verdict) : '',
                })}
          </DialogDescription>
        </DialogHeader>

        {group ? (
          <>
            <RadioList
              label={t(`dedup.cantAnswer.group.${group.mode}.title`)}
              options={group.answers.map((a) => ({
                value: a.key,
                label: t(`dedup.cantAnswer.option.${a.key}.label`),
                help: t(`dedup.cantAnswer.option.${a.key}.help`),
              }))}
              value={answerKey}
              onChange={setAnswerKey}
            />
            <div className="rounded-md border border-gray-200">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setReporting((r) => !r)}
                aria-expanded={reporting}
              >
                {reporting ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {t('dedup.cantAnswer.alsoReport')} <span className="text-gray-400">{t('dedup.cantAnswer.optional')}</span>
              </button>
              {reporting && <div className="border-t border-gray-200 p-3">{issueForm}</div>}
            </div>
          </>
        ) : (
          <>
            {hasIssue(item) && (
              <p className="text-xs text-gray-500">
                {t('dedup.cantAnswer.alreadyReported', { list: item.issues!.map((i) => issueLabel(i.kind)).join(', ') })}
              </p>
            )}
            <RadioList
              label={t('dedup.cantAnswer.dataProblem')}
              options={ISSUES.map((i) => ({
                value: i.kind,
                label: issueLabel(i.kind),
                help: t(`dedup.cantAnswer.issueHelp.${i.kind}`),
              }))}
              value={issueKind}
              onChange={setIssueKind}
            />
            {issueForm}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)}>
            {t('dedup.common.cancel')}
          </Button>
          <Button className="cursor-pointer" onClick={submit} disabled={busy || noteMissing}>
            {busy ? t('dedup.common.saving') : t(group ? 'dedup.common.save' : 'dedup.cantAnswer.reportButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RadioList({
  label,
  options,
  value,
  onChange,
}: Readonly<{
  label: string;
  options: { value: string; label: string; help: string }[];
  value: string;
  onChange: (v: string) => void;
}>) {
  return (
    <div role="radiogroup" aria-label={label}>
      <fieldset className="space-y-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 ${
              value === o.value ? 'border-gray-300 bg-gray-50' : 'border-transparent hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name={label}
              className="mt-1 cursor-pointer"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">{o.label}</span>
              <span className="block text-xs text-gray-500">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
