import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ChevronDown, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimplePagination } from '@/components/ui/simple-pagination';
import type { AdminPairRow, PairFilters, PairSort } from '../api/review';
import { useAdminPairs, useAnnotators, useBatches } from '../hooks/useReview';
import { abstentionLabel, answerLabel, batchNames, formatDateTime, formatNumber } from '../utils';

const PAGE = 50;
const SORTS: PairSort[] = ['newest', 'oldest', 'id_desc', 'id_asc'];
// "none" = no final answer yet.
const ANSWERS = ['same', 'different', 'contains', 'part_of', 'source_dup', 'not_sure', 'none'];
// URL keys of the filters behind the Filters button (search and sort sit outside it).
const FILTER_KEYS = ['batch', 'answer', 'annotator', 'adjudicator', 'admin', 'corrected'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
// What the chosen person did on the pair (an admin: corrected its answer); its URL key
// holds the person.
type PersonRole = 'annotator' | 'adjudicator' | 'admin';
const PERSON_ROLES: PersonRole[] = ['annotator', 'adjudicator', 'admin'];
const CORRECTED: Record<string, boolean | undefined> = { yes: true, no: false };
const SELECT = 'h-9 w-full cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-900';

const VERDICT_STYLE: Record<string, string> = {
  same: 'bg-green-50 text-green-700',
  different: 'bg-red-50 text-red-700',
};

function Answer({ row }: Readonly<{ row: AdminPairRow }>) {
  const { t } = useTranslation();
  if (!row.verdict) return <span className="text-xs text-gray-400">{t('dedup.admin.pairs.noAnswer')}</span>;
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${VERDICT_STYLE[row.verdict] ?? 'bg-gray-100 text-gray-700'}`}
      title={row.abstention_reason ? abstentionLabel(row.abstention_reason) : undefined}
    >
      {answerLabel(row.verdict)}
    </span>
  );
}

// Admins only: every handed-out pair with its current final answer. Search, filters and
// sort live in the URL, so Back from a pair returns to the same view. A row opens the
// pair on the answer screen, where the admin can correct it.
export default function AdminPairList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const batches = useBatches();
  const annotators = useAnnotators();
  const names = useMemo(() => batchNames(batches.data ?? []), [batches.data]);
  const everyone = annotators.data ?? [];
  // The names offered for each role: people who have ever held a pair to annotate, and
  // adjudicators plus anyone (admins too) who has adjudicated, and the admins. Someone doing
  // several jobs is in each of those lists.
  const peopleFor: Record<PersonRole, typeof everyone> = {
    annotator: everyone.filter((a) => a.assigned > 0),
    adjudicator: everyone.filter((a) => a.role === 'reviewer' || a.adjudicated > 0 || a.adjudication_active_seconds > 0),
    admin: everyone.filter((a) => a.role === 'admin'),
  };
  // The role picked in the label: the one with a person chosen, else the last one picked.
  const [roleChoice, setRoleChoice] = useState<PersonRole>(PERSON_ROLES.find((r) => params.get(r)) ?? 'annotator');
  const personRole = PERSON_ROLES.find((r) => params.get(r)) ?? roleChoice;
  const person = params.get(personRole) ?? '';
  // Switching role keeps the person when they are in the other list too.
  const switchRole = (next: PersonRole) => {
    setRoleChoice(next);
    const nextParams = new URLSearchParams(params);
    PERSON_ROLES.forEach((r) => nextParams.delete(r));
    if (person && peopleFor[next].some((a) => a.user_id === person)) nextParams.set(next, person);
    nextParams.delete('page');
    setParams(nextParams, { replace: true });
  };

  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const corrected = params.get('corrected');
  const filters: PairFilters = {
    batch_id: params.get('batch') ?? undefined,
    verdict: params.get('answer') ?? undefined,
    annotator_id: params.get('annotator') ?? undefined,
    adjudicator_id: params.get('adjudicator') ?? undefined,
    corrected_by: params.get('admin') ?? undefined,
    corrected: CORRECTED[corrected ?? ''],
    q: params.get('q') ?? undefined,
    sort: (params.get('sort') as PairSort | null) ?? 'newest',
    offset: page * PAGE,
    limit: PAGE,
  };
  const list = useAdminPairs(filters);

  const [search, setSearch] = useState(filters.q ?? '');
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);
  const [showFilters, setShowFilters] = useState(false);

  // Any change other than the page starts again from the first page.
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const text = search.trim();
    // A batch is shown by its name ("Second batch"), so typing that name (or part of it,
    // e.g. "second") picks the batch filter. Batch ids, pair numbers, titles and pasted
    // MW ids are searched on the server.
    const typed = text.toLowerCase();
    const byName = typed.length >= 3 && !/^#?\d+$/.test(typed)
      ? Object.entries(names).filter(([, name]) => name.toLowerCase().includes(typed))
      : [];
    const next = new URLSearchParams(params);
    next.delete('page');
    if (byName.length === 1) {
      next.set('batch', byName[0][0]);
      next.delete('q');
      setSearch('');
    } else if (text) next.set('q', text);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  // What each active filter reads as on its chip.
  const valueLabel = (key: FilterKey, v: string): string => {
    if (key === 'batch') return names[v] ?? v;
    if (key === 'answer') return v === 'none' ? t('dedup.admin.pairs.noAnswer') : answerLabel(v);
    if (key === 'annotator' || key === 'adjudicator' || key === 'admin') {
      const a = everyone.find((p) => p.user_id === v);
      return a?.name ?? a?.email ?? v;
    }
    return t(v === 'yes' ? 'dedup.admin.pairs.correctedYes' : 'dedup.admin.pairs.correctedNo');
  };
  const active = FILTER_KEYS.filter((k) => params.get(k));

  const total = list.data?.total ?? 0;
  const rows = list.data?.rows ?? [];
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE);
  const open = (id: number) =>
    navigate(`/dedup-admin/pairs/${id}`, { state: { from: location.search, ids: rows.map((r) => r.item_id) } });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold text-gray-900">{t('dedup.admin.nav.pairs')}</h1>
      <p className="mt-1 text-sm text-gray-600">{t('dedup.admin.pairs.subtitle')}</p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dedup.admin.pairs.searchPlaceholder')}
            aria-label={t('dedup.admin.pairs.searchPlaceholder')}
            className="h-9 pl-9"
          />
        </form>
        <Button
          variant="outline"
          className={`h-9 cursor-pointer ${showFilters ? 'bg-gray-100' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal className="h-4 w-4" /> {t('dedup.admin.pairs.filters')}
          {active.length > 0 && (
            <span className="ml-0.5 rounded-full bg-gray-900 px-1.5 text-[11px] font-medium leading-5 text-white">{active.length}</span>
          )}
        </Button>
        <label className="flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white pl-2.5 text-sm text-gray-600">
          <ArrowDownUp className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="sr-only">{t('dedup.admin.pairs.sort')}</span>
          <select
            value={filters.sort}
            onChange={(e) => set('sort', e.target.value === 'newest' ? '' : e.target.value)}
            className="h-full cursor-pointer rounded-md bg-transparent pr-2 text-sm text-gray-900 focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`dedup.admin.pairs.sorts.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showFilters && (
        <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterField label={t('dedup.admin.pairs.batch')}>
            <select className={SELECT} value={filters.batch_id ?? ''} onChange={(e) => set('batch', e.target.value)}>
              <option value="">{t('dedup.admin.pairs.any')}</option>
              {(batches.data ?? []).map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {names[b.batch_id] ?? b.batch_id}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t('dedup.admin.pairs.answer')}>
            <select className={SELECT} value={filters.verdict ?? ''} onChange={(e) => set('answer', e.target.value)}>
              <option value="">{t('dedup.admin.pairs.any')}</option>
              {ANSWERS.map((v) => (
                <option key={v} value={v}>
                  {v === 'none' ? t('dedup.admin.pairs.noAnswer') : answerLabel(v)}
                </option>
              ))}
            </select>
          </FilterField>
          {/* The label is itself a choice: which role the person below had on the pair. */}
          <div>
            {/* Same height as the other filters' labels, so the boxes below line up. */}
            <span className="relative mb-1 flex h-4 w-fit items-center text-xs leading-4 text-gray-600 hover:text-gray-900">
              <select
                value={personRole}
                onChange={(e) => switchRole(e.target.value as PersonRole)}
                aria-label={t('dedup.admin.pairs.personRole')}
                title={t('dedup.admin.pairs.personRole')}
                className="h-4 cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0 pr-4 text-xs font-medium leading-4 text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                {PERSON_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`dedup.admin.pairs.${r}`)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 h-3.5 w-3.5" aria-hidden />
            </span>
            <select
              className={SELECT}
              value={person}
              onChange={(e) => set(personRole, e.target.value)}
              aria-label={t(`dedup.admin.pairs.${personRole}`)}
            >
              <option value="">{t('dedup.admin.pairs.any')}</option>
              {peopleFor[personRole].map((a) => (
                <option key={a.user_id} value={a.user_id}>
                  {a.name ?? a.email ?? a.user_id}
                </option>
              ))}
            </select>
          </div>
          <FilterField label={t('dedup.admin.pairs.corrected')}>
            <select className={SELECT} value={corrected ?? ''} onChange={(e) => set('corrected', e.target.value)}>
              <option value="">{t('dedup.admin.pairs.any')}</option>
              <option value="yes">{t('dedup.admin.pairs.correctedYes')}</option>
              <option value="no">{t('dedup.admin.pairs.correctedNo')}</option>
            </select>
          </FilterField>
        </div>
      )}

      {(active.length > 0 || filters.q) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {filters.q && (
            <Chip label={`${t('dedup.admin.pairs.search')}: ${filters.q}`} onRemove={() => set('q', '')} removeLabel={t('dedup.admin.pairs.remove')} />
          )}
          {active.map((k) => (
            <Chip
              key={k}
              label={`${t('dedup.admin.pairs.' + k)}: ${valueLabel(k, params.get(k)!)}`}
              onRemove={() => set(k, '')}
              removeLabel={t('dedup.admin.pairs.remove')}
            />
          ))}
          <button
            type="button"
            onClick={() => setParams(params.get('sort') ? new URLSearchParams({ sort: params.get('sort')! }) : new URLSearchParams(), { replace: true })}
            className="cursor-pointer text-xs font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            {t('dedup.admin.pairs.clear')}
          </button>
        </div>
      )}

      {list.error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.queue.loadFailed', { error: list.error.message })}
        </div>
      )}

      <div className={`mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm ${list.isFetching ? 'opacity-70' : ''}`}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">{t('dedup.admin.annotator.pair')}</th>
              <th className="px-3 py-2">{t('dedup.admin.pairs.texts')}</th>
              <th className="px-3 py-2">{t('dedup.admin.pairs.answer')}</th>
              <th className="px-3 py-2">{t('dedup.admin.pairs.answeredBy')}</th>
              <th className="px-3 py-2">{t('dedup.admin.pairs.when')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-3 py-3">
                    <div className="h-8 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))}
            {rows.map((r) => (
              <tr
                key={r.item_id}
                onClick={() => open(r.item_id)}
                onKeyDown={(e) => e.key === 'Enter' && open(r.item_id)}
                tabIndex={0}
                className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
              >
                <td className="whitespace-nowrap px-3 py-2.5 align-top">
                  <div className="font-medium tabular-nums text-gray-900">{r.item_id}</div>
                  <div className="text-xs text-gray-500" title={r.batch_id}>
                    {names[r.batch_id] ?? r.batch_id}
                  </div>
                </td>
                <td className="min-w-[16rem] px-3 py-2.5 align-top">
                  <div className="break-words font-monlam text-sm leading-relaxed text-gray-900">{r.title_a || '—'}</div>
                  <div className="break-words font-monlam text-sm leading-relaxed text-gray-500">{r.title_b || '—'}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 align-top">
                  <Answer row={r} />
                  {r.corrected && (
                    <span className="ml-1.5 inline-flex align-middle text-blue-700" title={t('dedup.admin.pair.correctedBadge')}>
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <div className="text-gray-900">{r.answered_by_name ?? '—'}</div>
                  {r.answered_role && r.answered_role !== 'annotator' && (
                    <div className="text-xs text-gray-500">{t(`dedup.admin.pair.role.${r.answered_role}`, { defaultValue: r.answered_role })}</div>
                  )}
                  {!r.answered_by_name && r.annotator_names.length > 0 && (
                    <div className="text-xs text-gray-500">{t('dedup.admin.pairs.heldBy', { names: r.annotator_names.join(', ') })}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-gray-600">{formatDateTime(r.decided_at)}</td>
              </tr>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-gray-500">
                  {t('dedup.admin.pairs.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SimplePagination
        className="mt-3"
        canGoPrev={page > 0}
        canGoNext={to < total}
        onPrev={() => set('page', page - 1 ? String(page - 1) : '')}
        onNext={() => set('page', String(page + 1))}
        label={
          <span className="whitespace-nowrap text-sm text-gray-600">
            {t('dedup.admin.pairs.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}
          </span>
        }
        labelPosition="left"
        isDisabled={list.isFetching}
      />
    </div>
  );
}

function FilterField({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function Chip({ label, onRemove, removeLabel }: Readonly<{ label: string; onRemove: () => void; removeLabel: string }>) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-300 bg-white py-0.5 pl-2.5 pr-1 text-xs text-gray-700">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${removeLabel} ${label}`}
        className="cursor-pointer rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
