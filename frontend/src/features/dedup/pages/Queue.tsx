import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, Eye, Flag, Gavel, Lock, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUser } from '@/hooks/useUser';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MyItemsState, ReviewItem } from '../api/review';
import { useAdjudicationQueue, useBatchName, useClaimItems, useMyItems } from '../hooks/useReview';
import { dedupRole, formatNumber, hasIssue, isDecided, isDedupAdmin, verdictLabel } from '../utils';

// "To do" opens first, so annotators see only the work left; "Done" is where they find a
// pair they answered to check or change it. No "All": it mixed the two and confused people.
const STATE_TABS: MyItemsState[] = ['open', 'done'];

const VERDICT_STYLE: Record<string, string> = {
  same: 'bg-green-50 text-green-700',
  different: 'bg-red-50 text-red-700',
};

const isDone = (it: ReviewItem) => isDecided(it);

type RowStatus = 'done' | 'progress' | 'new';
// Done = answered (a reported problem alone is not an answer); "In progress" = opened but not answered.
function rowStatus(it: ReviewItem): RowStatus {
  if (isDone(it)) return 'done';
  return it.assignment?.first_opened_at ? 'progress' : 'new';
}
// Labels: dedup.queue.status.<RowStatus>.
const STATUS_STYLE: Record<RowStatus, string> = {
  done: 'bg-green-50 text-green-700',
  progress: 'bg-amber-50 text-amber-800',
  new: 'bg-gray-100 text-gray-600',
};

export default function Queue() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const batchName = useBatchName();
  const { user } = useUser();
  // The tab lives in the URL (?tab=done), so "back" from a pair returns to the same tab.
  const [params, setParams] = useSearchParams();
  const state: MyItemsState = params.get('tab') === 'done' ? 'done' : 'open';
  const setState = (key: MyItemsState) => setParams(key === 'open' ? {} : { tab: key }, { replace: true });
  const [q, setQ] = useState('');
  // Reviewers are the Deduplicator's adjudicators: they have no annotation work.
  const isReviewer = dedupRole(user) === 'reviewer';
  const isAdmin = isDedupAdmin(user);

  const items = useMyItems(state, undefined, !isReviewer);
  const openItems = useMyItems('open', undefined, !isReviewer);
  // Numbered from the full list so an item keeps its number in every tab.
  const allItems = useMyItems('all', undefined, !isReviewer);
  const toAdjudicate = useAdjudicationQueue('open', isAdmin);
  const numberOf = useMemo(
    () => new Map((allItems.data ?? []).map((it, i) => [it.item_id, i + 1])),
    [allItems.data],
  );
  const claim = useClaimItems();

  const loaded = useMemo(() => items.data ?? [], [items.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return loaded;
    // A number finds the pair by its number in this list or by the id in a shared link.
    const number = needle.replace(/^#/, '');
    const isNumber = /^\d+$/.test(number);
    return loaded.filter(
      (it) =>
        (isNumber && (String(it.item_id) === number || String(numberOf.get(it.item_id)) === number)) ||
        (it.evidence.a?.title_bo ?? '').toLowerCase().includes(needle) ||
        (it.evidence.b?.title_bo ?? '').toLowerCase().includes(needle),
    );
  }, [loaded, q, numberOf]);

  const myOpen = openItems.data?.length ?? 0;
  // The pair page's previous / next walk this tab's list.
  const openItem = (itemId: number) => navigate(`/dedup/item/${itemId}`, { state: { tab: state } });

  const assignWork = async () => {
    try {
      const res = await claim.mutateAsync();
      if (res.items.length === 0) toast.info(t('dedup.queue.noneLeft'));
      else if (res.claimed > 0) toast.success(t('dedup.queue.assigned', { count: res.claimed, n: formatNumber(res.claimed) }));
    } catch (e) {
      toast.error(t('dedup.queue.assignFailed', { error: (e as Error).message }));
    }
  };

  if (isReviewer) return <Navigate to="/dedup/adjudicate" replace />;

  let emptyText = t('dedup.queue.empty');
  if (q) emptyText = t('dedup.common.noMatch', { q });
  else if (state !== 'done') emptyText = t('dedup.queue.emptyToDo', { button: t('dedup.queue.assignWork') });

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('dedup.queue.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {t('dedup.queue.subtitle')}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
        <Button asChild variant="outline" className="cursor-pointer">
          <Link to="/dedup/my-stats">
            <BarChart3 className="h-4 w-4" /> {t('dedup.myStats.title')}
          </Link>
        </Button>
        {isAdmin && (
          <Button asChild variant="outline" className="cursor-pointer">
            <Link to="/dedup/adjudicate">
              <Gavel className="h-4 w-4" /> {t('dedup.adjudicationQueue.title')}
              {(toAdjudicate.data?.length ?? 0) > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 text-xs font-semibold text-indigo-800 tabular-nums">
                  {toAdjudicate.data?.length}
                </span>
              )}
            </Link>
          </Button>
        )}
        {isAdmin && (
          <Button asChild variant="outline" className="cursor-pointer">
            <Link to="/dedup-admin">
              <Settings className="h-4 w-4" /> {t('dedup.queue.admin')}
            </Link>
          </Button>
        )}
        <Button
          className="flex-1 cursor-pointer sm:flex-none"
          onClick={assignWork}
          disabled={claim.isPending || myOpen > 0}
          title={myOpen > 0 ? t('dedup.queue.finishFirst') : undefined}
        >
          {claim.isPending ? t('dedup.queue.assigning') : t('dedup.queue.assignWork')}
        </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {STATE_TABS.length > 1 ? (
        <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist">
          {STATE_TABS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={state === key}
              onClick={() => setState(key)}
              className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
                state === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t(`dedup.queue.tab.${key}`)}
            </button>
          ))}
        </div>
        ) : (
          <span />
        )}
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('dedup.common.searchTitlesOrNumber')}
          className="w-full sm:w-72"
        />
      </div>

      {items.error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.queue.loadFailed', { error: items.error.message })}
        </div>
      )}

      <ul className="space-y-2 sm:hidden">
        {items.isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-28 animate-pulse rounded-lg bg-gray-100" />
          ))}
        {rows.map((it) => {
          const done = isDone(it);
          const status = rowStatus(it);
          return (
            <li key={it.item_id}>
              <button
                onClick={() => openItem(it.item_id)}
                className="w-full cursor-pointer rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                  <span className="tabular-nums" title={t('dedup.common.itemId', { id: it.item_id })}>
                    {t('dedup.common.number')} {numberOf.get(it.item_id) ?? '—'} · {batchName(it.batch_id)}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 font-medium ${STATUS_STYLE[status]}`}>
                    {t(`dedup.queue.status.${status}`)}
                  </span>
                </div>
                <div className="mt-2 break-words font-monlam text-base leading-relaxed text-gray-900">
                  {it.evidence.a?.title_bo || '—'}
                </div>
                <div className="break-words font-monlam text-sm leading-relaxed text-gray-500">
                  {it.evidence.b?.title_bo || '—'}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <DecisionBadge item={it} />
                  <span
                    className={`inline-flex items-center gap-1 text-sm font-medium ${done ? 'text-gray-600' : 'text-blue-700'}`}
                  >
                    {done ? (
                      <>
                        <Eye className="h-3.5 w-3.5" /> {t('dedup.common.view')}
                      </>
                    ) : (
                      <>
                        {t('dedup.queue.review')} <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
        {!items.isLoading && rows.length === 0 && (
          <li className="rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">{emptyText}</li>
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm sm:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-16 px-4 py-3 font-medium">{t('dedup.common.number')}</th>
              <th className="px-4 py-3 font-medium">{t('dedup.common.texts')}</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">{t('dedup.common.batch')}</th>
              <th className="px-4 py-3 font-medium">{t('dedup.common.status')}</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">{t('dedup.queue.decision')}</th>
              <th className="w-32 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-10 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))}
            {rows.map((it) => {
              const done = isDone(it);
              const status = rowStatus(it);
              return (
                <tr
                  key={it.item_id}
                  onClick={() => openItem(it.item_id)}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-4 tabular-nums text-gray-500" title={t('dedup.common.itemId', { id: it.item_id })}>
                    {numberOf.get(it.item_id) ?? '—'}
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-monlam text-base leading-relaxed text-gray-900">
                      {it.evidence.a?.title_bo || '—'}
                    </div>
                    <div className="font-monlam text-sm leading-relaxed text-gray-500">
                      {it.evidence.b?.title_bo || '—'}
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-4 text-sm text-gray-600 md:table-cell" title={it.batch_id}>
                    {batchName(it.batch_id)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
                      {t(`dedup.queue.status.${status}`)}
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-4 sm:table-cell">
                    <DecisionBadge item={it} />
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openItem(it.item_id);
                      }}
                      className={
                        done
                          ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          : 'border-blue-300 text-blue-700 hover:bg-blue-50 hover:text-blue-800'
                      }
                    >
                      {done ? (
                        <>
                          <Eye className="h-3.5 w-3.5" /> {t('dedup.common.view')}
                        </>
                      ) : (
                        <>
                          {t('dedup.queue.review')} <ArrowRight className="h-3.5 w-3.5" />
                        </>
                      )}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!items.isLoading && rows.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-500">{emptyText}</p>
        )}
      </div>

      <div className="mt-3 text-sm text-gray-600">
        {q ? (
          <>
            {t('dedup.common.matchesIn', { count: rows.length, n: formatNumber(rows.length), total: formatNumber(loaded.length) })}
          </>
        ) : (
          <>
            {t('dedup.queue.itemCount', { count: loaded.length, n: formatNumber(loaded.length) })}
          </>
        )}
      </div>
    </div>
  );
}

function DecisionBadge({ item }: { item: ReviewItem }) {
  const { t } = useTranslation();
  const problem = hasIssue(item) && (
    <span title={t('dedup.queue.problemReported')}>
      <Flag className="inline h-3.5 w-3.5 text-amber-600" aria-label={t('dedup.queue.problemReported')} />
    </span>
  );
  const locked = item.locked && (
    <span title={t('dedup.queue.lockedTitle')}>
      <Lock className="inline h-3.5 w-3.5 text-gray-400" aria-label={t('dedup.queue.locked')} />
    </span>
  );
  if (item.verdict) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            VERDICT_STYLE[item.verdict] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {verdictLabel(item.verdict)}
        </span>
        {problem}
        {locked}
      </span>
    );
  }
  if (problem) {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        {t('dedup.queue.problemNeedsAnswer')}
      </span>
    );
  }
  return <span className="text-gray-300">—</span>;
}
