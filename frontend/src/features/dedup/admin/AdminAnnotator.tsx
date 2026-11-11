import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MyItemsState, ReviewItem } from '../api/review';
import { useAdminOverview, useAnnotatorItems, useAnnotators, useReassign } from '../hooks/useReview';
import { answerLabel, batchNames, formatDateTime, formatNumber, hasIssue, isDecided } from '../utils';
import { Person } from './AdminAnnotators';
import AnswerCounts from './AnswerCounts';
import InfoTip from './InfoTip';
import PeriodFilter from './PeriodFilter';
import { usePeriod } from '../hooks/usePeriod';
import { notesOf } from '../notes';

const TABS: MyItemsState[] = ['all', 'open', 'done'];

// Only unfinished items can be moved: an answered item belongs to whoever answered it.
const isFinished = (it: ReviewItem) => Boolean(it.assignment?.completed_at);

type Pending = { kind: 'reassign'; to: string } | { kind: 'release' };

export default function AdminAnnotator() {
  const { t } = useTranslation();
  const { userId = '' } = useParams();
  const [state, setState] = useState<MyItemsState>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);

  const period = usePeriod();
  const annotators = useAnnotators(period.period);
  // A period lists the pairs answered in it, so the tabs have no meaning then.
  const items = useAnnotatorItems(userId, period.filtered ? 'done' : state, period.period);
  const overview = useAdminOverview();
  const reassign = useReassign();

  const person = annotators.data?.find((a) => a.user_id === userId);
  // Adjudicators (reviewers) do not take annotation work.
  const targets = (annotators.data ?? []).filter(
    (a) => a.has_access && a.user_id !== userId && a.role !== 'reviewer',
  );
  const targetPerson = targets.find((a) => a.user_id === target);
  const names = useMemo(() => batchNames(overview.data?.batches ?? []), [overview.data?.batches]);

  // Notes are saved with the answer, so only answered pairs can have them.
  const [withNotes, setWithNotes] = useState(false);
  const rows = (items.data ?? []).filter((it) => !withNotes || notesOf(it.partner_payload).length > 0);
  const movable = rows.filter((it) => !isFinished(it));
  const allMovableSelected = movable.length > 0 && movable.every((it) => selected.has(it.item_id));

  // Drop selections that are no longer on screen or no longer movable.
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => movable.some((it) => it.item_id === id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async () => {
    if (!pending) return;
    try {
      const res = await reassign.mutateAsync({
        itemIds: [...selected],
        toUserId: pending.kind === 'reassign' ? pending.to : null,
        // Each pair has two annotators: only this person's place moves.
        fromUserId: userId,
      });
      const count = res.moved.length;
      toast.success(
        pending.kind === 'reassign'
          ? t('dedup.admin.annotator.moved', { count, n: formatNumber(count), name: targetPerson?.name || targetPerson?.email })
          : t('dedup.admin.annotator.unassigned', { count, n: formatNumber(count) }),
      );
      if (res.skipped.length) {
        toast.info(t('dedup.admin.annotator.skipped', { n: formatNumber(res.skipped.length) }));
      }
      setSelected(new Set());
      setPending(null);
    } catch (e) {
      toast.error(t('dedup.admin.annotator.updateFailed', { error: (e as Error).message }));
    }
  };

  const n = selected.size;
  const who = person?.name || person?.email || t('dedup.admin.annotator.thisAnnotator');
  const targetName = targetPerson?.name || targetPerson?.email;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: n ? 112 : undefined }}>
      <Link to={`/dedup-admin/annotators${period.search}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> {t('dedup.admin.nav.annotators')}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        {person ? <Person a={person} /> : <div className="h-8" />}
        {person && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-green-50 px-3 py-1 text-green-700">
              {t('dedup.admin.batch.answered', { n: formatNumber(person.done) })}
            </span>
            {person.changed > 0 && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                {t('dedup.admin.annotators.card.changed', { n: formatNumber(person.changed) })}
              </span>
            )}
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
              {t('dedup.admin.annotators.card.opened', { n: formatNumber(person.in_progress) })}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600">
              {t('dedup.admin.annotators.card.notOpened', { n: formatNumber(person.not_started) })}
            </span>
          </div>
        )}
      </div>
      {person && person.done > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1">
            {t('dedup.admin.annotator.answers')} <InfoTip text={t('dedup.admin.annotator.answersTip')} />
          </span>
          <AnswerCounts a={person} all />
        </div>
      )}

      <div className={period.filtered ? 'mt-4 mb-3' : 'mt-4'}>
        <PeriodFilter state={period} />
        {period.filtered && <p className="mt-2 text-xs text-gray-500">{t('dedup.admin.period.annotatorHint')}</p>}
      </div>

      {(withNotes || (person?.notes ?? 0) > 0) && (
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
          {t('dedup.admin.annotator.withNotes')}
          <span className="tabular-nums text-gray-500">({formatNumber(person?.notes ?? 0)})</span>
        </label>
      )}

      {!period.filtered && (
        <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist">
            {TABS.map((key) => (
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
          <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            {t('dedup.admin.annotator.tickHint')} <Lock className="h-3.5 w-3.5" /> {t('dedup.admin.annotator.answeredStay')}
          </p>
        </div>
      )}

      {items.error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.queue.loadFailed', { error: items.error.message })}
        </div>
      )}

      {/* Phones */}
      <ul className="space-y-2 sm:hidden">
        {items.isLoading &&
          Array.from({ length: 3 }).map((_, i) => <li key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />)}
        {rows.map((it) => {
          const finished = isFinished(it);
          const picked = selected.has(it.item_id);
          return (
            <li key={it.item_id}>
              <div
                role={finished ? undefined : 'checkbox'}
                aria-checked={finished ? undefined : picked}
                tabIndex={finished ? undefined : 0}
                onClick={() => !finished && toggle(it.item_id)}
                onKeyDown={(e) => {
                  if (!finished && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    toggle(it.item_id);
                  }
                }}
                className={`flex gap-3 rounded-lg border p-3 ${
                  finished
                    ? 'border-gray-200 bg-gray-50'
                    : `cursor-pointer bg-white ${picked ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200'}`
                }`}
              >
                <span className="pt-0.5">
                  {finished ? (
                    <Lock className="h-4 w-4 text-gray-400" />
                  ) : (
                    <input type="checkbox" readOnly tabIndex={-1} checked={picked} className="pointer-events-none" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span className="tabular-nums">
                      {t('dedup.pairView.title', { id: it.item_id })} · {names[it.batch_id] ?? it.batch_id}
                    </span>
                    <ItemStatus item={it} />
                  </div>
                  <div className={`mt-1 break-words font-monlam text-base leading-relaxed ${finished ? 'text-gray-500' : 'text-gray-900'}`}>
                    {it.evidence.a?.title_bo || '—'}
                  </div>
                  <div className="break-words font-monlam text-sm leading-relaxed text-gray-500">
                    {it.evidence.b?.title_bo || '—'}
                  </div>
                  {finished && (
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                      <span>{t('dedup.admin.annotator.answeredOn', { when: formatDateTime(it.assignment?.completed_at) })}</span>
                      {it.answer_changed_at && <ChangedOn item={it} />}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {!items.isLoading && rows.length === 0 && (
          <li className="rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">{t('dedup.adjudicationQueue.empty')}</li>
        )}
      </ul>

      {/* Tablets and up */}
      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm sm:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr className="whitespace-nowrap">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={t('dedup.admin.annotator.selectAll')}
                  className="cursor-pointer"
                  disabled={movable.length === 0}
                  checked={allMovableSelected}
                  onChange={() =>
                    setSelected(allMovableSelected ? new Set() : new Set(movable.map((it) => it.item_id)))
                  }
                />
              </th>
              <th className="px-3 py-3 font-medium">{t('dedup.admin.annotator.pair')}</th>
              <th className="px-3 py-3 font-medium">{t('dedup.common.texts')}</th>
              <th className="hidden px-3 py-3 font-medium md:table-cell">{t('dedup.common.batch')}</th>
              <th className="hidden px-3 py-3 font-medium lg:table-cell">
                <span className="inline-flex items-center gap-1">
                  {t('dedup.admin.annotator.answeredCol')} <InfoTip text={t('dedup.admin.annotator.answeredColTip')} />
                </span>
              </th>
              <th className="hidden px-3 py-3 font-medium lg:table-cell">
                <span className="inline-flex items-center gap-1">
                  {t('dedup.admin.annotator.changedCol')} <InfoTip text={t('dedup.admin.annotator.changedColTip')} />
                </span>
              </th>
              <th className="px-3 py-3 font-medium">{t('dedup.common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={7} className="px-4 py-3">
                    <div className="h-8 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))}
            {rows.map((it) => {
              const finished = isFinished(it);
              return (
                <tr
                  key={it.item_id}
                  onClick={() => !finished && toggle(it.item_id)}
                  className={
                    finished
                      ? 'bg-gray-50 text-gray-400'
                      : `cursor-pointer hover:bg-gray-50 ${selected.has(it.item_id) ? 'bg-blue-50/60' : ''}`
                  }
                >
                  <td className="px-4 py-3">
                    {finished ? (
                      <span title={t('dedup.admin.annotator.answeredStaysTitle')} className="inline-flex text-gray-400">
                        <Lock className="h-4 w-4" />
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={t('dedup.admin.annotator.selectPair', { id: it.item_id })}
                        className="cursor-pointer"
                        checked={selected.has(it.item_id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(it.item_id)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-gray-500">{it.item_id}</td>
                  <td className="px-3 py-3">
                    <div className={`break-words font-monlam text-base leading-relaxed ${finished ? 'text-gray-500' : 'text-gray-900'}`}>
                      {it.evidence.a?.title_bo || '—'}
                    </div>
                    <div className={`break-words font-monlam text-sm leading-relaxed ${finished ? 'text-gray-400' : 'text-gray-500'}`}>
                      {it.evidence.b?.title_bo || '—'}
                    </div>
                    {/* Tablets: the date columns would not fit, so the dates go here. */}
                    {finished && (
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500 lg:hidden">
                        <span>{t('dedup.admin.annotator.answeredOn', { when: formatDateTime(it.assignment?.completed_at) })}</span>
                        {it.answer_changed_at && <ChangedOn item={it} />}
                      </div>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-gray-600 md:table-cell" title={it.batch_id}>
                    {names[it.batch_id] ?? it.batch_id}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-xs text-gray-500 lg:table-cell">
                    {it.assignment?.completed_at ? formatDateTime(it.assignment.completed_at) : '—'}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-xs text-gray-500 lg:table-cell">
                    {it.answer_changed_at ? <ChangedOn item={it} short /> : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <ItemStatus item={it} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!items.isLoading && rows.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-500">{t('dedup.adjudicationQueue.empty')}</p>
        )}
      </div>

      {n > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
            <span className="text-sm font-medium text-gray-900">
              {t('dedup.admin.annotator.selected', { count: n, n: formatNumber(n) })}
            </span>
            <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full min-w-0 cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-2 text-sm sm:w-auto sm:max-w-xs"
                aria-label={t('dedup.admin.annotator.reassignTo')}
              >
                <option value="">{t('dedup.admin.annotator.reassignToPlaceholder')}</option>
                {targets.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {t('dedup.admin.annotator.targetOption', { name: a.name || a.email, n: formatNumber(a.assigned - a.done) })}
                  </option>
                ))}
              </select>
              <Button
                className="cursor-pointer"
                disabled={!target}
                onClick={() => setPending({ kind: 'reassign', to: target })}
              >
                {t('dedup.admin.annotator.reassign')}
              </Button>
              <span className="inline-flex items-center gap-1">
                <Button variant="outline" className="cursor-pointer" onClick={() => setPending({ kind: 'release' })}>
                  {t('dedup.admin.annotator.unassign')}
                </Button>
                <InfoTip
                  text={t('dedup.admin.annotator.unassignTip')}
                />
              </span>
              <Button variant="ghost" className="cursor-pointer" onClick={() => setSelected(new Set())}>
                {t('dedup.admin.annotator.clear')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={pending != null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'reassign'
                ? t('dedup.admin.annotator.confirmMove', { count: n, n: formatNumber(n), name: targetName })
                : t('dedup.admin.annotator.confirmUnassign', { count: n, n: formatNumber(n) })}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'reassign'
                ? t('dedup.admin.annotator.confirmMoveHelp', { from: who, to: targetName })
                : t('dedup.admin.annotator.confirmUnassignHelp', { from: who })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setPending(null)}>
              {t('dedup.common.cancel')}
            </Button>
            <Button className="cursor-pointer" onClick={confirm} disabled={reassign.isPending}>
              {reassign.isPending
                ? t('dedup.common.saving')
                : t(pending?.kind === 'reassign' ? 'dedup.admin.annotator.move' : 'dedup.admin.annotator.unassign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Latest change of the person's own answer, and how many times they changed it. */
function ChangedOn({ item, short = false }: Readonly<{ item: ReviewItem; short?: boolean }>) {
  const { t } = useTranslation();
  const when = formatDateTime(item.answer_changed_at);
  const times = item.answer_changes > 1 ? ` (${t('dedup.admin.annotator.changedTimes', { n: formatNumber(item.answer_changes) })})` : '';
  return <span>{short ? `${when}${times}` : t('dedup.admin.annotator.changedOn', { when }) + times}</span>;
}

// Same colours as the answer buttons and the answer counts.
const VERDICT_STYLE: Record<string, string> = {
  same: 'bg-green-50 text-green-700',
  different: 'bg-red-50 text-red-700',
  not_sure: 'bg-amber-50 text-amber-800',
};

function ItemStatus({ item }: Readonly<{ item: ReviewItem }>) {
  const { t } = useTranslation();
  if (isDecided(item)) {
    return (
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          VERDICT_STYLE[item.verdict!] ?? 'bg-gray-100 text-gray-700'
        }`}
      >
        {answerLabel(item.verdict)}
        {hasIssue(item) && ' · problem reported'}
      </span>
    );
  }
  if (hasIssue(item)) {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        {t('dedup.queue.problemNeedsAnswer')}
      </span>
    );
  }
  if (item.assignment?.first_opened_at) {
    return <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">{t('dedup.admin.annotators.col.opened')}</span>;
  }
  return <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">{t('dedup.admin.annotators.col.notOpened')}</span>;
}
