import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { answerLabel, formatDate, formatDuration, formatNumber } from '../utils';

/** One finished pair: when, its answer (named in the hover text), and the time spent on
 * it (admins only). */
export interface BarEntry {
  at: Date;
  answer?: string | null;
  seconds?: number;
}

type Unit = 'hour' | 'day' | 'week' | 'month';
type Measure = 'pairs' | 'time';

interface Bar {
  start: Date;
  end: Date;
  pairs: number;
  seconds: number;
  /** Pairs per answer, for the hover text. */
  answers: Record<string, number>;
}

// The hover text lists answers in the order of the answer buttons; others after them.
const ANSWER_ORDER = ['same', 'different', 'contains', 'part_of', 'source_dup', 'not_sure'];
const answerRank = (a: string) => {
  const i = ANSWER_ORDER.indexOf(a);
  return i < 0 ? ANSWER_ORDER.length : i;
};

const DAY = 24 * 3_600_000;

/** Where `d`'s bar starts: its hour, day, week (from Monday) or month (local time). */
function barStart(d: Date, unit: Unit): Date {
  const s = new Date(d);
  s.setMinutes(0, 0, 0);
  if (unit === 'hour') return s;
  s.setHours(0);
  if (unit === 'week') s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  if (unit === 'month') s.setDate(1);
  return s;
}

function nextStart(d: Date, unit: Unit): Date {
  const n = new Date(d);
  if (unit === 'hour') n.setHours(n.getHours() + 1);
  else if (unit === 'month') n.setMonth(n.getMonth() + 1);
  else n.setDate(n.getDate() + (unit === 'week' ? 7 : 1));
  return n;
}

/** Bars for the period (or from the first entry to now), empty ones included: per hour
 * for one day, per day up to a month, per week up to six months, per month beyond. */
function makeBars(entries: BarEntry[], since?: string, until?: string): { unit: Unit; bars: Bar[] } {
  const first = entries.reduce<Date | null>((m, e) => (!m || e.at < m ? e.at : m), null);
  const from = since ? new Date(since) : first;
  if (!from) return { unit: 'day', bars: [] };
  const end = until ? new Date(new Date(until).getTime() - 1) : new Date();
  const span = end.getTime() - from.getTime();
  let unit: Unit = 'month';
  if (span <= DAY) unit = 'hour';
  else if (span <= 31 * DAY) unit = 'day';
  else if (span <= 183 * DAY) unit = 'week';

  const bars: Bar[] = [];
  const index = new Map<number, Bar>();
  for (let s = barStart(from, unit); s <= end; s = nextStart(s, unit)) {
    const bar: Bar = { start: s, end: nextStart(s, unit), pairs: 0, seconds: 0, answers: {} };
    bars.push(bar);
    index.set(s.getTime(), bar);
  }
  for (const e of entries) {
    const bar = index.get(barStart(e.at, unit).getTime());
    if (!bar) continue;
    bar.pairs += 1;
    bar.seconds += e.seconds ?? 0;
    if (e.answer) bar.answers[e.answer] = (bar.answers[e.answer] ?? 0) + 1;
  }
  return { unit, bars };
}

/** Under the bar, in the app's language: "9 AM", "Sat 21", "21 Nov", "Nov 2026". */
function shortLabel(d: Date, unit: Unit, fewDays: boolean): string {
  if (unit === 'hour') return formatDate(d, 'hour');
  if (unit === 'month') return formatDate(d, 'monthYear');
  return formatDate(d, unit === 'day' && fewDays ? 'weekdayDay' : 'dayMonth');
}

/** On hover, the bar's whole span: "Saturday, 21 November", "22 Jun – 28 Jun", "November 2026". */
function longLabel(b: Bar, unit: Unit): string {
  if (unit === 'hour') return `${formatDate(b.start, 'time')} – ${formatDate(b.end, 'time')}`;
  if (unit === 'day') return formatDate(b.start, 'weekdayLong');
  if (unit === 'month') return formatDate(b.start, 'monthYearLong');
  return `${formatDate(b.start, 'dayMonth')} – ${formatDate(new Date(b.end.getTime() - DAY), 'dayMonth')}`;
}

/** Short enough to sit on a bar: "45m", "2.5h" (Tibetan digits and units in Tibetan). */
function shortTime(seconds: number, t: (k: string, o?: Record<string, string>) => string): string {
  if (seconds < 3600) return t('dedup.bars.minutesShort', { n: formatNumber(Math.max(1, Math.round(seconds / 60))) });
  const h = seconds / 3600;
  const shown = h < 10 ? Math.round(h * 10) / 10 : Math.round(h);
  return t('dedup.bars.hoursShort', { n: formatNumber(shown) });
}

/**
 * One plain bar per hour, day, week or month, in one colour, with its number on top and
 * the heading saying what one bar is. Made to be read at a glance, without a scale or a
 * legend. `withTime` (admins) adds a Pairs | Time switch.
 */
export default function SimpleBarChart({
  entries,
  since,
  until,
  noun,
  withTime = false,
}: Readonly<{
  entries: BarEntry[];
  since?: string;
  until?: string;
  /** What was done to a pair: "done" (annotators) or "settled" (adjudicators). */
  noun: 'done' | 'settled';
  withTime?: boolean;
}>) {
  const { t } = useTranslation();
  const [measure, setMeasure] = useState<Measure>('pairs');
  const time = withTime && measure === 'time';
  const { unit, bars } = useMemo(() => makeBars(entries, since, until), [entries, since, until]);
  const valueOf = (b: Bar) => (time ? b.seconds : b.pairs);
  const max = Math.max(1, ...bars.map(valueOf));
  // Every bar named when they fit; otherwise about ten names.
  const labelEvery = bars.length <= 12 ? 1 : Math.ceil(bars.length / 10);
  const small = bars.length > 16;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-base font-medium text-gray-900">
          {t(time ? `dedup.bars.timeWorked.${unit}` : `dedup.bars.${noun}.${unit}`)}
        </h2>
        {withTime && (
          <div className="inline-flex rounded-md bg-gray-100 p-0.5" role="radiogroup" aria-label={t('dedup.bars.show')}>
            {(['pairs', 'time'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={measure === m}
                onClick={() => setMeasure(m)}
                className={`cursor-pointer rounded px-3 py-1 text-sm font-medium ${
                  measure === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t(`dedup.bars.${m}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">{t('dedup.bars.empty')}</p>
      ) : (
        <>
          {/* Room above the tallest bar for its number. */}
          <div className={`mt-8 flex h-44 items-end border-b border-gray-300 ${small ? 'gap-[3px]' : 'gap-2'}`}>
            {bars.map((b) => {
              const value = valueOf(b);
              const pct = (value / max) * 100;
              const hover = [
                longLabel(b, unit),
                t('dedup.bars.pairsCount', { count: b.pairs, n: formatNumber(b.pairs) }),
                // The answers in this bar, e.g. "Same: 9", "Different: 4".
                ...Object.entries(b.answers)
                  .sort(([x], [y]) => answerRank(x) - answerRank(y))
                  .map(([answer, n]) => `  ${answerLabel(answer)}: ${formatNumber(n)}`),
                ...(withTime && b.pairs ? [t('dedup.bars.timeSpent', { time: formatDuration(b.seconds) })] : []),
              ].join('\n');
              return (
                <div key={b.start.getTime()} title={hover} className="relative flex h-full min-w-0 flex-1 items-end">
                  {value > 0 && (
                    <>
                      <span
                        className={`absolute inset-x-0 text-center font-semibold tabular-nums text-gray-800 ${small ? 'text-[10px]' : 'text-sm'}`}
                        style={{ bottom: `calc(${pct}% + 3px)` }}
                      >
                        {time ? shortTime(value, t) : formatNumber(value)}
                      </span>
                      <span
                        className={`w-full rounded-t ${time ? 'bg-sky-600' : 'bg-emerald-600'}`}
                        style={{ height: `${pct}%` }}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className={`mt-1.5 flex text-gray-600 ${small ? 'gap-[3px] text-[10px]' : 'gap-2 text-xs'}`}>
            {bars.map((b, i) => (
              <span key={b.start.getTime()} className="min-w-0 flex-1 whitespace-nowrap text-center">
                {i % labelEvery === 0 ? shortLabel(b.start, unit, bars.length <= 7) : ''}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
