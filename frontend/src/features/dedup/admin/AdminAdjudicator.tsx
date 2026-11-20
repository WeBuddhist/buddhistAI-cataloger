import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AdminAdjudication } from '../api/review';
import SimpleBarChart from '../components/SimpleBarChart';
import { useShowStats } from '../hooks/useShowStats';
import ShowStatsToggle from './ShowStatsToggle';
import { usePeriod } from '../hooks/usePeriod';
import { useAdminAdjudications, useAdminOverview, useAnnotators } from '../hooks/useReview';
import { answerLabel, batchNames, formatDateTime, formatDuration, formatNumber, parseUtc } from '../utils';
import { Person } from './AdminAnnotators';
import AnswerCounts from './AnswerCounts';
import InfoTip from './InfoTip';
import PeriodFilter from './PeriodFilter';

// "corrected": settled pairs whose final answer an admin later changed, the adjudicator's
// counterpart of an annotator's "Overruled".
type Tab = 'progress' | 'settled' | 'all' | 'corrected';
const TABS: Tab[] = ['progress', 'settled', 'all', 'corrected'];
// A period lists the pairs settled in it; what is open is open now, whatever the period.
const PERIOD_TABS: Tab[] = ['settled', 'progress', 'corrected'];

// Same colours as the answer chips elsewhere.
const VERDICT_STYLE: Record<string, string> = {
  same: 'bg-green-50 text-green-700',
  different: 'bg-red-50 text-red-700',
  not_sure: 'bg-amber-50 text-amber-800',
};

function Chip({ verdict }: Readonly<{ verdict: string | null }>) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${(verdict && VERDICT_STYLE[verdict]) || 'bg-gray-100 text-gray-700'}`}>
      {answerLabel(verdict)}
    </span>
  );
}

// One adjudicator's pairs: what they have open now, what they settled (in the period),
// with a chart of settled pairs (or time) over time. A row opens the pair.
export default function AdminAdjudicator() {
  const { t } = useTranslation();
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const period = usePeriod();
  const annotators = useAnnotators(period.period);
  const overview = useAdminOverview();
  const names = useMemo(() => batchNames(overview.data?.batches ?? []), [overview.data?.batches]);
  const open = useAdminAdjudications('open', userId);
  const settled = useAdminAdjudications('done', userId, period.period);
  const [showStats, setShowStats] = useShowStats();

  const [params, setParams] = useSearchParams();
  const settledRows = useMemo(() => settled.data ?? [], [settled.data]);
  const correctedRows = useMemo(() => settledRows.filter((a) => a.corrected_verdict), [settledRows]);
  // "Corrected by admin" only shows when there is at least one such pair.
  const tabs = (period.filtered ? PERIOD_TABS : TABS).filter((k) => k !== 'corrected' || correctedRows.length > 0);
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : tabs[0];
  const setTab = (next: Tab) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === tabs[0]) p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );

  const person = annotators.data?.find((a) => a.user_id === userId);
  const openRows = open.data ?? [];
  const count: Record<Tab, number> = {
    progress: openRows.length,
    settled: settledRows.length,
    all: openRows.length + settledRows.length,
    corrected: correctedRows.length,
  };
  let rows: AdminAdjudication[] = settledRows;
  if (tab === 'progress') rows = openRows;
  else if (tab === 'all') rows = [...openRows, ...settledRows];
  else if (tab === 'corrected') rows = correctedRows;
  const usesOpen = tab === 'progress' || tab === 'all';
  const usesSettled = tab !== 'progress';
  const loading = (usesOpen && open.isLoading) || (usesSettled && settled.isLoading);
  const error = open.error ?? settled.error;

  // Their final answers in the period: the same badges as an annotator's "Answers".
  const finalAnswers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of settledRows) if (a.verdict) out[a.verdict] = (out[a.verdict] ?? 0) + 1;
    return out;
  }, [settledRows]);

  const entries = useMemo(
    () =>
      settledRows
        .filter((a) => a.completed_at)
        .map((a) => ({ at: parseUtc(a.completed_at!), answer: a.verdict, seconds: a.seconds ?? 0 })),
    [settledRows],
  );
  const settledSeconds = settledRows.reduce((s, a) => s + (a.seconds ?? 0), 0);

  const openPair = (id: number) =>
    void navigate(`/dedup-admin/pairs/${id}`, { state: { ids: rows.map((r) => r.item_id) } });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Link to={`/dedup-admin/annotators${period.search}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> {t('dedup.admin.nav.annotators')}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        {person ? <Person a={person} /> : <div className="h-8" />}
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-green-50 px-3 py-1 text-green-700">
            {t('dedup.admin.adjudicator.settledCount', { n: formatNumber(settledRows.length) })}
          </span>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
            {t('dedup.admin.adjudicator.progressCount', { n: formatNumber(openRows.length) })}
          </span>
          {settledRows.length > 0 && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
              {t('dedup.admin.adjudicator.perPair', { time: formatDuration(settledSeconds / settledRows.length) })}
            </span>
          )}
        </div>
      </div>
      {settledRows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1">
            {t('dedup.admin.adjudicator.answers')} <InfoTip text={t('dedup.admin.adjudicator.answersTip')} />
          </span>
          <AnswerCounts a={{ answers: finalAnswers }} all />
        </div>
      )}

      <div className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PeriodFilter state={period} />
          <ShowStatsToggle on={showStats} onChange={setShowStats} />
        </div>
        {period.filtered && <p className="mt-2 text-xs text-gray-500">{t('dedup.admin.adjudicator.periodHint')}</p>}
      </div>

      {showStats && settled.data && (
        <div className={`mt-4 ${settled.isFetching ? 'opacity-70' : ''}`}>
          <SimpleBarChart entries={entries} since={period.period.since} until={period.period.until} noun="settled" withTime />
        </div>
      )}

      <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist">
          {tabs.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t(`dedup.admin.adjudicator.tab.${key}`)}
              <span className="ml-1.5 tabular-nums text-gray-500">{formatNumber(count[key])}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {t(tab === 'corrected' ? 'dedup.admin.adjudicator.correctedHint' : 'dedup.admin.adjudicator.rowHint')}
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.queue.loadFailed', { error: error.message })}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr className="whitespace-nowrap">
              <th className="px-4 py-3 font-medium">{t('dedup.admin.annotator.pair')}</th>
              <th className="px-3 py-3 font-medium">{t('dedup.common.texts')}</th>
              <th className="hidden px-3 py-3 font-medium md:table-cell">{t('dedup.adjudicationQueue.annotatorsSaid')}</th>
              <th className="px-3 py-3 font-medium">{t('dedup.review.finalAnswer')}</th>
              <th className="hidden px-3 py-3 font-medium lg:table-cell">{t('dedup.admin.adjudicator.when')}</th>
              <th className="hidden px-3 py-3 text-right font-medium sm:table-cell">{t('dedup.admin.adjudicator.time')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-8 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))}
            {rows.map((a) => (
              <tr
                key={a.item_id}
                onClick={() => openPair(a.item_id)}
                onKeyDown={(e) => e.key === 'Enter' && openPair(a.item_id)}
                tabIndex={0}
                className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
              >
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <div className="font-medium tabular-nums text-gray-900">{a.item_id}</div>
                  <div className="text-xs text-gray-500" title={a.batch_id}>{names[a.batch_id] ?? a.batch_id}</div>
                </td>
                <td className="min-w-[14rem] px-3 py-3 align-top">
                  <div className="break-words font-monlam text-sm leading-relaxed text-gray-900">{a.title_a || '—'}</div>
                  <div className="break-words font-monlam text-sm leading-relaxed text-gray-500">{a.title_b || '—'}</div>
                </td>
                <td className="hidden px-3 py-3 align-top md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {a.annotations.map((ans, i) => (
                      <Chip key={ans.annotator_id ?? i} verdict={ans.verdict} />
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-top">
                  {a.completed_at ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <Chip verdict={a.verdict} />
                      {/* Changed later by an admin: their answer, then the admin's. */}
                      {a.corrected_verdict && (
                        <>
                          <ArrowRight className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                          <span
                            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${VERDICT_STYLE[a.corrected_verdict] ?? 'bg-gray-100 text-gray-700'}`}
                            title={t('dedup.admin.adjudicator.correctedTitle')}
                          >
                            {t('dedup.admin.adjudicator.adminAnswer', { answer: answerLabel(a.corrected_verdict) })}
                          </span>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      {t('dedup.admin.adjudications.status.progress')}
                    </span>
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3 align-top text-xs text-gray-500 lg:table-cell">
                  {a.completed_at
                    ? t('dedup.admin.adjudicator.settledOn', { when: formatDateTime(a.completed_at) })
                    : t('dedup.admin.adjudicator.takenOn', { when: formatDateTime(a.reserved_at) })}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3 text-right align-top tabular-nums text-gray-600 sm:table-cell">
                  {a.seconds ? formatDuration(a.seconds) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-500">{t(`dedup.admin.adjudicator.empty.${tab}`)}</p>
        )}
      </div>
    </div>
  );
}
