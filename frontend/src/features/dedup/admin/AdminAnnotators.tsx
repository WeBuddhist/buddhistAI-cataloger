import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Annotator } from '../api/review';
import { useAnnotators } from '../hooks/useReview';
import i18n from '@/i18n/config';
import { useTranslation } from 'react-i18next';
import { answerGroups, formatDateTime, formatDuration, formatNumber } from '../utils';
import InfoTip from './InfoTip';
import PeriodFilter from './PeriodFilter';
import { usePeriod } from '../hooks/usePeriod';

// Each view describes one job: a person who does both appears in both, with only that
// side of their work.
type View = 'annotation' | 'adjudication';
const VIEWS: View[] = ['annotation', 'adjudication'];
const VIEW_KEY = 'dedup.admin.annotators.view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'adjudication' ? 'adjudication' : 'annotation';
  } catch {
    return 'annotation';
  }
}

// Adjudicators (reviewers) never take annotation work; admins can do both.
const annotates = (a: Annotator) => a.role !== 'reviewer' || a.assigned > 0;
const adjudicates = (a: Annotator) => a.role === 'reviewer' || a.adjudicated > 0 || a.adjudication_active_seconds > 0;

export default function AdminAnnotators() {
  const { t } = useTranslation();
  const period = usePeriod();
  const annotators = useAnnotators(period.period);
  const navigate = useNavigate();
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Remembering the view is a convenience only.
    }
  };
  // Keep the chosen period on the person's page.
  const open = (a: Annotator) => navigate(`/dedup-admin/annotators/${encodeURIComponent(a.user_id)}${period.search}`);

  const all = annotators.data ?? [];
  const rows =
    view === 'annotation'
      ? all.filter(annotates)
      : all
          .filter(adjudicates)
          .sort((x, y) => y.adjudicated - x.adjudicated || (x.name || x.email || '').localeCompare(y.name || y.email || ''));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('dedup.admin.nav.annotators')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('dedup.admin.annotators.subtitle')}</p>
        </div>
        {/* What the colours in "Answered" / "Final answers" mean: always in sight, since hover does not work on phones. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label={t('dedup.admin.annotators.legend')}>
          {answerGroups({}).map((g) => (
            <li key={g.label} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${g.bar}`} /> {g.label}
            </li>
          ))}
          {view === 'annotation' && (
            <li className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-gray-200" /> {t('dedup.admin.batch.bdrcStatus.new')}
            </li>
          )}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist" aria-label={t('dedup.admin.annotators.view.label')}>
          {VIEWS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
                view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t(`dedup.admin.annotators.view.${key}`)}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <PeriodFilter state={period} />
          {period.filtered && <p className="mt-2 text-xs text-gray-500">{t('dedup.admin.period.annotatorsHint')}</p>}
        </div>
      </div>

      {annotators.error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.admin.annotators.loadFailed', { error: annotators.error.message })}
        </div>
      )}
      {annotators.isLoading && <div className="mt-6 h-40 animate-pulse rounded-xl bg-gray-100" />}
      {annotators.data && rows.length === 0 && (
        <p className="mt-6 rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
          {all.length === 0 || view === 'annotation' ? t('dedup.admin.annotators.nobody') : t('dedup.admin.annotators.nobodyAdjudicates')}
        </p>
      )}

      {rows.length > 0 &&
        (view === 'annotation' ? (
          <AnnotationList rows={rows} filtered={period.filtered} open={open} />
        ) : (
          <AdjudicationList rows={rows} />
        ))}
    </div>
  );
}

function AnnotationList({
  rows,
  filtered,
  open,
}: Readonly<{ rows: Annotator[]; filtered: boolean; open: (a: Annotator) => void }>) {
  const { t } = useTranslation();
  return (
    <>
      {/* Phones and tablets */}
      <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">
        {rows.map((a) => (
          <li key={a.user_id}>
            <button
              onClick={() => open(a)}
              className="w-full cursor-pointer rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50"
            >
              <Person a={a} />
              <div className="mt-3">
                <Progress a={a} filtered={filtered} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                {a.changed > 0 && <span>{t('dedup.admin.annotators.card.changed', { n: formatNumber(a.changed) })}</span>}
                <span>{t('dedup.admin.annotators.card.opened', { n: formatNumber(a.in_progress) })}</span>
                <span>{t('dedup.admin.annotators.card.notOpened', { n: formatNumber(a.not_started) })}</span>
                <span>{t('dedup.admin.annotators.card.total', { time: formatDuration(a.total_active_seconds) })}</span>
                <span>{t('dedup.admin.annotators.card.perPair', { time: formatDuration(a.avg_active_seconds) })}</span>
                <span>{t('dedup.admin.annotators.card.agreed', { value: agreement(a) })}</span>
                {a.disputed > 0 && <span>{t('dedup.admin.annotators.card.disputed', { n: formatNumber(a.disputed) })}</span>}
                {a.upheld_of > 0 && <span>{t('dedup.admin.annotators.card.upheld', { value: ratio(a.upheld, a.upheld_of) })}</span>}
                {a.notes > 0 && <span>{t('dedup.admin.annotators.card.notes', { n: formatNumber(a.notes) })}</span>}
                <span>{t('dedup.admin.annotators.card.active', { when: formatDateTime(a.last_active) })}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Laptops and up */}
      <div className="mt-6 hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm lg:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr className="whitespace-nowrap">
              <th className="rounded-tl-lg px-4 py-3 font-medium">{t('dedup.admin.annotators.col.annotator')}</th>
              <Th label={t('dedup.admin.annotators.col.answered')} tip={t('dedup.admin.annotators.col.answeredTip')} />
              <Th label={t('dedup.admin.annotators.col.changed')} tip={t('dedup.admin.annotators.col.changedTip')} right />
              <Th label={t('dedup.admin.annotators.col.waiting')} tip={t('dedup.admin.annotators.col.waitingTip')} right />
              <Th label={t('dedup.admin.annotators.col.totalTime')} tip={t('dedup.admin.annotators.col.totalTimeTip')} right />
              <Th label={t('dedup.admin.annotators.col.perPair')} tip={t('dedup.admin.annotators.col.perPairTip')} right />
              <Th label={t('dedup.admin.overview.agreement')} tip={t('dedup.admin.annotators.col.agreementTip')} right />
              <Th label={t('dedup.admin.annotators.col.disputed')} tip={t('dedup.admin.annotators.col.disputedTip')} right />
              <Th label={t('dedup.admin.annotators.col.upheld')} tip={t('dedup.admin.annotators.col.upheldTip')} right />
              <Th label={t('dedup.admin.annotators.col.notes')} tip={t('dedup.admin.annotators.col.notesTip')} right />
              {/* Under the name on smaller laptops, to keep the table from scrolling. */}
              <th className="hidden px-3 py-3 font-medium xl:table-cell">{t('dedup.admin.annotators.col.lastActive')}</th>
              <th className="w-8 rounded-tr-lg px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((a) => (
              <tr key={a.user_id} onClick={() => open(a)} className="cursor-pointer hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Person a={a} />
                  <div className="mt-1 pl-11 text-xs text-gray-400 xl:hidden">
                    {t('dedup.admin.annotators.card.active', { when: formatDateTime(a.last_active) })}
                  </div>
                </td>
                <td className="w-44 px-3 py-3">
                  <Progress a={a} filtered={filtered} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{a.changed ? formatNumber(a.changed) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-xs">
                  <div className="tabular-nums text-amber-700">{t('dedup.admin.annotators.card.opened', { n: formatNumber(a.in_progress) })}</div>
                  <div className="tabular-nums text-gray-500">{t('dedup.admin.annotators.card.notOpened', { n: formatNumber(a.not_started) })}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatDuration(a.total_active_seconds || null)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatDuration(a.avg_active_seconds)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{agreement(a)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{a.paired ? formatNumber(a.disputed) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{a.upheld_of ? ratio(a.upheld, a.upheld_of) : '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{a.notes ? formatNumber(a.notes) : '—'}</td>
                <td className="hidden px-3 py-3 text-xs text-gray-500 xl:table-cell">
                  <LastActive iso={a.last_active} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ArrowRight className="ml-auto h-4 w-4 text-blue-700" aria-label={t('dedup.admin.annotators.open', { name: a.name || a.email })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The person's page lists annotation pairs, so adjudication rows do not open it.
function AdjudicationList({ rows }: Readonly<{ rows: Annotator[] }>) {
  const { t } = useTranslation();
  return (
    <>
      {/* Phones and tablets */}
      <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">
        {rows.map((a) => (
          <li key={a.user_id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <Person a={a} />
            <div className="mt-3">
              <FinalAnswers a={a} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{t('dedup.admin.annotators.card.adjudicationTime', { time: formatDuration(a.adjudication_active_seconds) })}</span>
              {a.avg_adjudication_seconds != null && (
                <span>{t('dedup.admin.annotators.card.perAdjudication', { time: formatDuration(a.avg_adjudication_seconds) })}</span>
              )}
              <span>{t('dedup.admin.annotators.card.total', { time: formatDuration(a.total_active_seconds) })}</span>
              {a.adjudication_notes > 0 && (
                <span>{t('dedup.admin.annotators.card.notes', { n: formatNumber(a.adjudication_notes) })}</span>
              )}
              <span>{t('dedup.admin.annotators.card.active', { when: formatDateTime(a.last_active) })}</span>
            </div>
          </li>
        ))}
      </ul>

      {/* Laptops and up */}
      <div className="mt-6 hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm lg:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr className="whitespace-nowrap">
              <th className="rounded-tl-lg px-4 py-3 font-medium">{t('dedup.admin.annotators.col.adjudicator')}</th>
              <Th label={t('dedup.admin.annotators.col.finalAnswers')} tip={t('dedup.admin.annotators.col.finalAnswersTip')} />
              <Th label={t('dedup.admin.annotators.col.adjudicationTime')} tip={t('dedup.admin.annotators.col.adjudicationTimeTip')} right />
              <Th label={t('dedup.admin.annotators.col.perAdjudication')} tip={t('dedup.admin.annotators.col.perAdjudicationTip')} right />
              <Th label={t('dedup.admin.annotators.col.totalTime')} tip={t('dedup.admin.annotators.col.totalTimeTip')} right />
              <Th label={t('dedup.admin.annotators.col.notes')} tip={t('dedup.admin.annotators.col.adjudicationNotesTip')} right />
              <th className="rounded-tr-lg px-3 py-3 font-medium">{t('dedup.admin.annotators.col.lastActive')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((a) => (
              <tr key={a.user_id}>
                <td className="px-4 py-3">
                  <Person a={a} />
                </td>
                <td className="w-56 px-3 py-3">
                  <FinalAnswers a={a} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatDuration(a.adjudication_active_seconds || null)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatDuration(a.avg_adjudication_seconds)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-gray-600">{formatDuration(a.total_active_seconds || null)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{a.adjudication_notes ? formatNumber(a.adjudication_notes) : '—'}</td>
                <td className="px-3 py-3 text-xs text-gray-500">
                  <LastActive iso={a.last_active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** A column heading kept on one line, with its explanation on hover. */
function Th({ label, tip, right = false }: Readonly<{ label: string; tip: string; right?: boolean }>) {
  return (
    <th className={`px-3 py-3 font-medium ${right ? 'text-right' : ''}`}>
      <span className="inline-flex items-center gap-1">
        {label} <InfoTip text={tip} />
      </span>
    </th>
  );
}

/** Date on one line, time on the next, so the column stays narrow. */
function LastActive({ iso }: Readonly<{ iso: string | null }>) {
  if (!iso) return <>—</>;
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return (
    <span title={formatDateTime(iso)} className="whitespace-nowrap">
      {d.toLocaleDateString(undefined, { dateStyle: 'medium' })}
      <br />
      {d.toLocaleTimeString(undefined, { timeStyle: 'short' })}
    </span>
  );
}

/** "8 of 10 (80%)". */
function ratio(n: number, total: number): string {
  return i18n.t('dedup.admin.annotators.agreementValue', {
    n: formatNumber(n),
    total: formatNumber(total),
    pct: formatNumber(Math.round((n / total) * 100)),
  });
}

/** "8 of 10 (80%)", or "—" before any pair has both answers. */
function agreement(a: Annotator): string {
  return a.paired ? ratio(a.agreed, a.paired) : '—';
}

// Answered out of given, as one bar split by answer (same, different, …); the light
// rest is not answered yet. One line below names the counts in the same colours.
// For a period, "of how many" has no meaning: only the answers in it are shown.
function Progress({ a, filtered = false }: Readonly<{ a: Annotator; filtered?: boolean }>) {
  const { t } = useTranslation();
  const answered = Object.values(a.answers).reduce((s, n) => s + n, 0);
  const heading = filtered
    ? t('dedup.admin.period.answered', { n: formatNumber(a.done) })
    : t('dedup.admin.annotators.doneOf', { n: formatNumber(a.done), total: formatNumber(a.assigned) });
  return <AnswerBar answers={a.answers} total={filtered ? answered : Math.max(a.assigned, answered)} heading={heading} />;
}

// The adjudicator's settled pairs, split by the final answer they gave.
function FinalAnswers({ a }: Readonly<{ a: Annotator }>) {
  const { t } = useTranslation();
  const heading = t('dedup.admin.annotators.settled', { n: formatNumber(a.adjudicated) });
  return <AnswerBar answers={a.adjudication_answers} total={a.adjudicated} heading={heading} />;
}

function AnswerBar({ answers, total, heading }: Readonly<{ answers: Record<string, number>; total: number; heading: string }>) {
  const groups = answerGroups(answers).filter((g) => g.n > 0);
  const hover = groups.map((g) => `${g.label}: ${formatNumber(g.n)}${g.detail ? ` (${g.detail})` : ''}`).join('\n');
  return (
    <div title={hover || undefined}>
      <div className="text-sm text-gray-700">{heading}</div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        {groups.map((g) => (
          <span key={g.label} className={`h-full ${g.bar}`} style={{ width: `${(g.n / (total || 1)) * 100}%` }} />
        ))}
      </div>
      {groups.length > 0 && (
        // Colour + dot per number; names are in the legend above the table and on hover.
        <div className="mt-1 flex flex-wrap gap-x-2.5 text-xs">
          {groups.map((g) => (
            <span key={g.label} className={`inline-flex items-center gap-1 ${g.text}`}>
              <span className={`h-2 w-2 rounded-full ${g.bar}`} aria-hidden="true" />
              <span className="tabular-nums font-medium">{formatNumber(g.n)}</span>
              <span className="sr-only">{g.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Person({ a }: Readonly<{ a: Pick<Annotator, 'name' | 'email' | 'picture' | 'has_access'> & { role?: string | null } }>) {
  const { t } = useTranslation();
  const initial = (a.name || a.email || '?').charAt(0).toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-3">
      {a.picture ? (
        <img src={a.picture} alt="" className="h-8 w-8 shrink-0 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-700">
          {initial}
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium text-gray-900">{a.name || a.email}</div>
        <div className="flex items-center gap-2 truncate text-xs text-gray-500">
          {a.name && <span className="truncate">{a.email}</span>}
          {a.role === 'reviewer' && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{t('dedup.admin.annotators.adjudicatorBadge')}</span>
          )}
          {!a.has_access && (
            <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">{t('dedup.admin.annotators.accessRemoved')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
