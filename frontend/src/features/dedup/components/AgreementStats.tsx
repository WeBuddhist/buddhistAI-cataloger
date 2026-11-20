import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MyAnsweredPair } from '../api/review';
import type { usePeriod } from '../hooks/usePeriod';
import { formatDate, formatNumber, formatPercent, parseUtc } from '../utils';
import SimpleBarChart from './SimpleBarChart';

// One person's answered pairs, by whether the other annotator gave the same answer: the
// annotator's own stats page and the admin's page for that person show the same.

type Status = MyAnsweredPair['status'];
type PeriodState = ReturnType<typeof usePeriod>;

function counts(pairs: MyAnsweredPair[]) {
  const n = (s: Status) => pairs.filter((p) => p.status === s).length;
  const agreed = n('agreed');
  return { agreed, compared: agreed + n('disagreed'), waiting: n('waiting') };
}

type Kind = 'double' | 'single';

/**
 * Cards, sentences and chart for one kind of review at a time: double review (two
 * annotators, so agreement) or single review (one annotator, no agreement). Both tabs
 * always show, with their counts for the period. The chosen tab is kept in the address
 * (`?review=single`), so it stays when the period changes and on reload; without a choice,
 * double review, or single review when the period has only that.
 */
export function ReviewStats({
  pairs,
  period,
  name,
  withTime = false,
}: Readonly<{ pairs: MyAnsweredPair[]; period: PeriodState; name?: string; withTime?: boolean }>) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const byKind = useMemo(
    () => ({
      single: pairs.filter((p) => p.status === 'single'),
      double: pairs.filter((p) => p.status !== 'single'),
    }),
    [pairs],
  );
  const asked = params.get('review');
  let kind: Kind = byKind.double.length === 0 && byKind.single.length > 0 ? 'single' : 'double';
  if (asked === 'single' || asked === 'double') kind = asked;
  const choose = (k: Kind) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('review', k);
        return p;
      },
      { replace: true },
    );
  const shown = byKind[kind];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist" aria-label={t('dedup.myStats.kind.label')}>
          {(['double', 'single'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => choose(k)}
              className={`cursor-pointer rounded px-3 py-1.5 text-base font-medium transition-colors ${
                kind === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t(`dedup.myStats.kind.${k}`)} <span className="tabular-nums text-gray-500">({formatNumber(byKind[k].length)})</span>
            </button>
          ))}
        </div>
      </div>
      <AgreementCards pairs={shown} single={kind === 'single'} />
      {shown.length > 0 && <AgreementSummary pairs={shown} period={period} name={name} />}
      <AgreementBars pairs={shown} since={period.period.since} until={period.period.until} withTime={withTime} />
    </div>
  );
}

/** Pairs done, and how often the other annotator gave the same answer. `single`: pairs
 * one annotator checked, so only their count. */
export function AgreementCards({ pairs, single = false }: Readonly<{ pairs: MyAnsweredPair[]; single?: boolean }>) {
  const { t } = useTranslation();
  const { agreed, compared, waiting } = counts(pairs);
  // One annotator per pair: nothing to agree on, so just the count, kept small.
  if (single) {
    return (
      <div className="flex items-baseline gap-3 rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <span className="text-3xl font-semibold tabular-nums text-gray-900">{formatNumber(pairs.length)}</span>
        <span className="text-base text-gray-600">{t('dedup.myStats.doneSingle')}</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="text-base text-gray-600">{t('dedup.myStats.done')}</div>
        <div className="mt-1 text-4xl font-semibold tabular-nums text-gray-900">{formatNumber(pairs.length)}</div>
        {waiting > 0 && <div className="mt-1 text-sm text-gray-500">{t('dedup.myStats.waitingCount', { n: formatNumber(waiting) })}</div>}
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="text-base text-gray-600">{t('dedup.myStats.agreement')}</div>
        <div className="mt-1 text-4xl font-semibold tabular-nums text-gray-900">
          {compared ? formatPercent(agreed / compared) : '—'}
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {compared
            ? t('dedup.myStats.agreedOf', { n: formatNumber(agreed), total: formatNumber(compared) })
            : t('dedup.myStats.noneCompared')}
        </div>
      </div>
    </div>
  );
}

/** "In the last 7 days" / "From 1 Oct to 15 Oct" / "In total": the chosen period in words. */
function periodWords(period: PeriodState, t: (k: string, o?: Record<string, string>) => string): string {
  if (period.key === 'custom' && period.from && period.to) {
    const day = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return formatDate(new Date(y, m - 1, d), 'dayMonthYear');
    };
    return t('dedup.summary.when.custom', { from: day(period.from), to: day(period.to) });
  }
  return t(`dedup.summary.when.${period.key === 'custom' ? 'all' : period.key}`);
}

/**
 * The numbers in plain sentences: how many pairs in the period, how many the other
 * annotator answered the same, and the busiest day. `name`: written about that person
 * (admins), else to the reader ("you").
 */
export function AgreementSummary({
  pairs,
  period,
  name,
}: Readonly<{ pairs: MyAnsweredPair[]; period: PeriodState; name?: string }>) {
  const { t } = useTranslation();
  const { agreed, compared } = counts(pairs);
  const busiest = useMemo(() => {
    const byDay = new Map<string, { date: Date; n: number }>();
    for (const p of pairs) {
      const d = parseUtc(p.answered_at);
      const key = d.toDateString();
      const day = byDay.get(key) ?? { date: d, n: 0 };
      day.n += 1;
      byDay.set(key, day);
    }
    return [...byDay.values()].reduce<{ date: Date; n: number } | null>((b, d) => (!b || d.n > b.n ? d : b), null);
  }, [pairs]);
  const who = name ? 'they' : 'you';
  const when = periodWords(period, t);

  return (
    <div className="space-y-1 rounded-lg bg-emerald-50 px-5 py-4 text-base leading-relaxed text-gray-800">
      <p>{t(`dedup.summary.${who}.answered`, { count: pairs.length, n: formatNumber(pairs.length), when, name })}</p>
      {compared > 0 && (
        <p>
          {t(`dedup.summary.${who}.agreed`, { n: formatNumber(agreed), total: formatNumber(compared), name })}
        </p>
      )}
      {busiest && period.key !== 'today' && busiest.n > 1 && (
        <p>
          {t(`dedup.summary.${who}.busiest`, {
            day: formatDate(busiest.date, 'weekdayLong'),
            n: formatNumber(busiest.n),
            name,
          })}
        </p>
      )}
    </div>
  );
}

/** Pairs done per hour / day / week / month; `withTime` (admins) adds time worked. */
export function AgreementBars({
  pairs,
  since,
  until,
  withTime = false,
}: Readonly<{ pairs: MyAnsweredPair[]; since?: string; until?: string; withTime?: boolean }>) {
  const entries = useMemo(
    () => pairs.map((p) => ({ at: parseUtc(p.answered_at), answer: p.verdict, seconds: p.seconds ?? undefined })),
    [pairs],
  );
  return <SimpleBarChart entries={entries} since={since} until={until} noun="done" withTime={withTime} />;
}
