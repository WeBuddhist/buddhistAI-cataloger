import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Hourglass, Inbox, Loader2, SkipForward } from 'lucide-react';
import AvatarWrapper from '@/components/AvatarWrapper';
import InfoTip from '@/features/dedup/admin/InfoTip';
import type { BatchProgress, PersonProgress } from '../api/admin';
import { useOverview } from '../hooks';
import { tr, useT } from '../i18n';

const TH = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500';
const NUM = `${TH} text-right`;
const TD = 'px-4 py-3 align-middle';
const TD_NUM = `${TD} text-right tabular-nums`;

const utc = (iso: string) => new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
const day = (iso: string) => utc(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Hours and minutes, in the language chosen: "2 h 05 min", "45 min". */
function spent(minutes: number): string {
  if (minutes < 60) return tr('overview.minutes', { m: minutes });
  return tr('overview.hours', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') });
}

/** Grey for 0, so a table of zeros still reads as a table. */
const tone = (n: number, color = 'text-gray-900') => (n ? color : 'text-gray-400');

/** How far each batch is, at BDRC and in this tool, and each person's work. Read-only. */
export default function AdminOverview() {
  const t = useT();
  const overview = useOverview();

  if (overview.isLoading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }
  if (overview.isError || !overview.data) {
    return <p className="py-8 text-sm text-red-700">{t('overview.loadFailed', { error: (overview.error as Error)?.message ?? '' })}</p>;
  }

  const { batches, batch_error, skipped_by_reason, duplicates, totals, people } = overview.data;

  return (
    <div className="space-y-6 py-6">
      <p className="text-sm text-gray-600">{t('overview.intro')}</p>

      {/* The work in this tool, over all batches */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={<Inbox className="h-4 w-4" />} label={t('overview.handedOut')} value={totals.handed_out} tip={t('overview.handedOutTip')} />
        <Stat icon={<CheckCircle2 className="h-4 w-4" />} label={t('overview.answered')} value={totals.answered} color="text-green-700" tip={t('overview.answeredTip')} />
        <Stat icon={<Hourglass className="h-4 w-4" />} label={t('overview.inProgress')} value={totals.in_progress} color="text-amber-700" tip={t('overview.inProgressTip')} />
        <Stat icon={<SkipForward className="h-4 w-4" />} label={t('overview.skipped')} value={totals.skipped} tip={t('overview.skippedTip')} />
        <Stat icon={<Clock className="h-4 w-4" />} label={t('overview.timeSpent')} value={totals.minutes} shown={spent(totals.minutes)} tip={t('overview.timeSpentTip')} />
      </div>

      <Section eyebrow={t('overview.batchesEyebrow')} title={t('overview.batches')} tip={t('overview.batchesTip')}>
        {batch_error && <p className="text-sm text-amber-800">{t('overview.batchFailed', { error: batch_error })}</p>}
        {!batch_error && batches.length === 0 && <p className="text-sm text-gray-500">{t('overview.noBatches')}</p>}
        {batches.length > 0 && <BatchTable batches={batches} />}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={t('overview.skippedWhy')} tip={t('overview.skippedWhyTip')}>
          <Counts
            rows={SKIP_KEYS.map((k) => [t(`skip.${k}`), skipped_by_reason[k] ?? 0])}
            empty={t('overview.noneSoFar')}
          />
        </Section>
        <Section title={t('overview.duplicates')} tip={t('overview.duplicatesTip')}>
          <Counts
            rows={DUP_KEYS.map((k) => [t(`overview.dup.${k}`), duplicates[k]])}
            empty={t('overview.noneSoFar')}
          />
          <Link to="/author-identification-admin/duplicates" className="mt-3 inline-block text-sm font-medium text-blue-700 hover:text-blue-800">
            {t('overview.seeDuplicates')} →
          </Link>
        </Section>
      </div>

      <Section title={t('overview.people')} tip={t('overview.peopleTip')}>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className={TH}>{t('overview.person')}</th>
                <th className={NUM}>{t('overview.given')}</th>
                <th className={NUM}>{t('overview.inProgress')}</th>
                <th className={NUM}>{t('overview.answered')}</th>
                <th className={NUM}>{t('overview.skipped')}</th>
                <th className={NUM}>{t('overview.time')}</th>
                <th className={TH}>{t('overview.lastActivity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {people.length === 0 ? (
                <tr>
                  <td colSpan={7} className={`${TD} py-8 text-center text-gray-500`}>
                    {t('overview.nobody')}
                  </td>
                </tr>
              ) : (
                people.map((p) => <PersonRow key={p.user_id} person={p} />)
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

const SKIP_KEYS = ['author_unknown', 'text_not_clean', 'text_not_cropped'] as const;
const DUP_KEYS = ['to_check', 'same', 'different'] as const;

/** Each label with its count and share, as on the Deduplicator's overview. */
function Counts({ rows, empty }: Readonly<{ rows: [string, number][]; empty: string }>) {
  const total = rows.reduce((n, [, v]) => n + v, 0);
  if (total === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map(([label, n]) => (
        <li key={label}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-gray-700">{label}</span>
            <span className={`tabular-nums ${tone(n)}`}>
              {n} <span className="text-xs text-gray-400">({Math.round((n / total) * 100)}%)</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <span className="block h-full rounded-full bg-gray-700" style={{ width: `${(n / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

type Col = 'total' | 'available' | 'inProgress' | 'done';

const COLS: { key: Col; color?: string }[] = [
  { key: 'total' },
  { key: 'available', color: 'text-blue-700' },
  { key: 'inProgress', color: 'text-amber-700' },
  { key: 'done', color: 'text-green-700' },
];

// Total and Done come from BDRC. BDRC doesn't know which texts were handed out, so
// Available and In progress use this tool's assignments, as in the Deduplicator.
function rowOf(b: BatchProgress): Record<Col, number> {
  const available = Math.max(0, b.total - b.handed_out);
  return { total: b.total, available, inProgress: Math.max(0, b.total - available - b.done), done: b.done };
}

function BatchTable({ batches }: Readonly<{ batches: BatchProgress[] }>) {
  const t = useT();
  const rows = batches.map((b) => ({ b, ...rowOf(b) }));
  const sum = (k: Col) => rows.reduce((n, r) => n + r[k], 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className={TH}>{t('overview.col.batch')}</th>
            {COLS.map((c) => (
              <th key={c.key} className={NUM}>
                <span className="inline-flex items-center gap-1">
                  {t(`overview.col.${c.key}`)}
                  <InfoTip text={t(`overview.col.${c.key}Tip`)} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.b.batch_id}>
              <td className={TD}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums text-gray-900">{r.b.batch_id}</span>
                  {r.b.current && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{t('overview.handingOut')}</span>
                  )}
                </div>
                {(r.b.note || r.b.created_at) && (
                  <div className="mt-0.5 text-xs text-gray-500">
                    {[r.b.note, r.b.created_at && t('overview.created', { date: day(r.b.created_at) })].filter(Boolean).join(' · ')}
                  </div>
                )}
              </td>
              {COLS.map((c) => (
                <td key={c.key} className={`${TD_NUM} ${tone(r[c.key], c.color)}`}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot className="border-t border-gray-200 bg-gray-50 font-medium">
            <tr>
              <td className={`${TD} text-gray-700`}>{t('overview.allBatches')}</td>
              {COLS.map((c) => (
                <td key={c.key} className={`${TD_NUM} text-gray-900`}>
                  {sum(c.key)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {sum('available') === 0 && (
        <p className="border-t border-gray-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">{t('overview.noneLeft')}</p>
      )}
    </div>
  );
}

function PersonRow({ person: p }: Readonly<{ person: PersonProgress }>) {
  const t = useT();
  const started = p.given + p.answered + p.skipped > 0;
  return (
    <tr>
      <td className={TD}>
        <div className="flex items-center gap-3">
          <div className="shrink-0">{p.picture && <AvatarWrapper src={p.picture} alt={p.name || p.email} />}</div>
          <div className="min-w-0">
            <div className={`truncate font-medium ${started ? 'text-gray-900' : 'text-gray-500'}`}>{p.name || p.email}</div>
            <div className="truncate text-xs text-gray-500">{t(`roles.${p.role}`)}</div>
          </div>
        </div>
      </td>
      <td className={`${TD_NUM} ${tone(p.given)}`}>{p.given}</td>
      <td className={`${TD_NUM} ${tone(p.in_progress, 'text-amber-700')}`}>{p.in_progress}</td>
      <td className={`${TD_NUM} ${tone(p.answered, 'text-green-700')}`}>{p.answered}</td>
      <td className={`${TD_NUM} ${tone(p.skipped)}`}>{p.skipped}</td>
      <td className={`${TD_NUM} ${tone(p.minutes)}`}>{started ? spent(p.minutes) : '–'}</td>
      <td className={`${TD} whitespace-nowrap text-gray-600`}>
        {p.last_activity
          ? utc(p.last_activity).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          : <span className="text-gray-400">{t('overview.notStarted')}</span>}
      </td>
    </tr>
  );
}

function Stat({ icon, label, value, shown, color, tip }: Readonly<{
  icon: ReactNode;
  label: string;
  value: number;
  /** What to show, when not the number itself (e.g. the time). */
  shown?: string;
  color?: string;
  tip: string;
}>) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <span className="text-gray-400">{icon}</span>
        {label}
        <InfoTip text={tip} />
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone(value, color)}`}>{shown ?? value}</div>
    </div>
  );
}

function Section({ title, tip, eyebrow, children }: Readonly<{ title: string; tip?: string; eyebrow?: string; children: ReactNode }>) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-red-700">{eyebrow}</div>}
      <h2 className="mb-3 flex items-center gap-1 text-sm font-semibold text-gray-900">
        {title}
        {tip && <InfoTip text={tip} />}
      </h2>
      {children}
    </section>
  );
}
