import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Search } from 'lucide-react';
import AvatarWrapper from '@/components/AvatarWrapper';
import { Input } from '@/components/ui/input';
import InfoTip from '@/features/dedup/admin/InfoTip';
import PeriodFilter from '@/features/dedup/admin/PeriodFilter';
import { usePeriod } from '@/features/dedup/hooks/usePeriod';
import type { PersonProgress } from '../api/admin';
import { useAnnotators } from '../hooks';
import { useT } from '../i18n';
import { FIELD } from '../utils';
import { spent, tone, utc } from './adminFormat';

type Role = 'all' | 'annotator' | 'admin';
type Status = 'all' | 'working' | 'notStarted';
type SortKey = 'name' | 'given' | 'in_progress' | 'answered' | 'skipped' | 'minutes' | 'perText' | 'last_activity';

const ROLES: Role[] = ['all', 'annotator', 'admin'];
const STATUSES: Status[] = ['all', 'working', 'notStarted'];

const TH = 'px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500';
const TD = 'px-4 py-3 align-middle';
const TD_NUM = `${TD} text-right tabular-nums`;

const started = (p: PersonProgress) => p.given + p.answered + p.skipped > 0;
/** Minutes per text answered or skipped; null before the first one. */
const perText = (p: PersonProgress) => (p.answered + p.skipped ? Math.round(p.minutes / (p.answered + p.skipped)) : null);

function valueOf(p: PersonProgress, key: SortKey): number | string {
  if (key === 'name') return (p.name || p.email).toLowerCase();
  if (key === 'perText') return perText(p) ?? -1;
  if (key === 'last_activity') return p.last_activity ?? '';
  return p[key];
}

/** Each person's work, with filters by role, status and period. Read-only. */
export default function AdminAnnotators() {
  const t = useT();
  const period = usePeriod();
  const annotators = useAnnotators(period.period);
  const [role, setRole] = useState<Role>('all');
  const [status, setStatus] = useState<Status>('all');
  const [search, setSearch] = useState('');
  // No sort chosen: the backend's order, the busiest first.
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (annotators.data ?? []).filter(
      (p) =>
        (role === 'all' || p.role === role) &&
        (status === 'all' || (status === 'working') === started(p)) &&
        (!q || `${p.name ?? ''} ${p.email}`.toLowerCase().includes(q)),
    );
    if (!sort) return list;
    return [...list].sort((a, b) => {
      const order = String(valueOf(a, sort.key)).localeCompare(String(valueOf(b, sort.key)), undefined, { numeric: true });
      return sort.desc ? -order : order;
    });
  }, [annotators.data, role, status, search, sort]);

  // Numbers start from the largest, names from A.
  const sortBy = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' }));

  const ariaSort = (key: SortKey) => {
    if (sort?.key !== key) return 'none';
    return sort.desc ? 'descending' : 'ascending';
  };

  const header = (key: SortKey, right = true, tip?: string) => (
    <th className={`${TH} ${right ? 'text-right' : 'text-left'}`} aria-sort={ariaSort(key)}>
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        {tip && <InfoTip text={tip} />}
        <button type="button" onClick={() => sortBy(key)} className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-gray-800">
          {t(`annotators.col.${key}`)}
          {sort?.key === key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
        </button>
      </span>
    </th>
  );

  return (
    <div className="space-y-4 py-6">
      <p className="text-sm text-gray-600">{t('annotators.intro')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Segments label={t('annotators.role')} options={ROLES} value={role} onChange={setRole} text={(r) => t(`annotators.roles.${r}`)} />
        <Segments label={t('annotators.status')} options={STATUSES} value={status} onChange={setStatus} text={(s) => t(`annotators.statuses.${s}`)} />
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('annotators.search')}
            aria-label={t('annotators.search')}
            className={`h-9 pl-8 ${FIELD}`}
          />
        </div>
      </div>
      <div>
        <PeriodFilter state={period} />
        {period.filtered && <p className="mt-2 text-xs text-gray-500">{t('annotators.periodHint')}</p>}
      </div>

      {annotators.isLoading && (
        <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
        </p>
      )}
      {annotators.isError && (
        <p className="py-8 text-sm text-red-700">{t('overview.loadFailed', { error: (annotators.error as Error).message })}</p>
      )}

      {annotators.data && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-gray-50">
              <tr>
                {header('name', false)}
                {header('given', true, t('annotators.col.givenTip'))}
                {header('in_progress', true, t('annotators.col.in_progressTip'))}
                {header('answered')}
                {header('skipped')}
                {header('minutes', true, t('annotators.col.minutesTip'))}
                {header('perText', true, t('annotators.col.perTextTip'))}
                {header('last_activity', false)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className={`${TD} py-8 text-center text-gray-500`}>
                    {annotators.data.length === 0 ? t('overview.nobody') : t('annotators.noMatch')}
                  </td>
                </tr>
              ) : (
                rows.map((p) => <PersonRow key={p.user_id} person={p} />)
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PersonRow({ person: p }: Readonly<{ person: PersonProgress }>) {
  const t = useT();
  const each = perText(p);
  return (
    <tr>
      <td className={TD}>
        <div className="flex items-center gap-3">
          <div className="shrink-0">{p.picture && <AvatarWrapper src={p.picture} alt={p.name || p.email} />}</div>
          <div className="min-w-0">
            <div className={`truncate font-medium ${started(p) ? 'text-gray-900' : 'text-gray-500'}`}>{p.name || p.email}</div>
            <div className="truncate text-xs text-gray-500">{t(`roles.${p.role}`)}</div>
          </div>
        </div>
      </td>
      <td className={`${TD_NUM} ${tone(p.given)}`}>{p.given}</td>
      <td className={`${TD_NUM} ${tone(p.in_progress, 'text-amber-700')}`}>{p.in_progress}</td>
      <td className={`${TD_NUM} ${tone(p.answered, 'text-green-700')}`}>{p.answered}</td>
      <td className={`${TD_NUM} ${tone(p.skipped)}`}>{p.skipped}</td>
      <td className={`${TD_NUM} ${tone(p.minutes)}`}>{started(p) ? spent(p.minutes) : '–'}</td>
      <td className={`${TD_NUM} ${tone(each ?? 0)}`}>{each === null ? '–' : spent(each)}</td>
      <td className={`${TD} whitespace-nowrap text-gray-600`}>
        {p.last_activity ? (
          utc(p.last_activity).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        ) : (
          <span className="text-gray-400">{t('overview.notStarted')}</span>
        )}
      </td>
    </tr>
  );
}

function Segments<K extends string>({ label, options, value, onChange, text }: Readonly<{
  label: string;
  options: K[];
  value: K;
  onChange: (k: K) => void;
  text: (k: K) => string;
}>) {
  // The label shows: two rows of bare buttons ("Everyone / Annotators", "All / Started")
  // do not say what each one filters.
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</span>
      <SegmentButtons label={label} options={options} value={value} onChange={onChange} text={text} />
    </div>
  );
}

function SegmentButtons<K extends string>({ label, options, value, onChange, text }: Readonly<{
  label: string;
  options: K[];
  value: K;
  onChange: (k: K) => void;
  text: (k: K) => string;
}>) {
  return (
    <div className="inline-flex rounded-md bg-gray-100 p-1" role="group" aria-label={label}>
      {options.map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
            value === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {text(k)}
        </button>
      ))}
    </div>
  );
}
