import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, Inbox, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthorIdMe } from '../access/hooks';
import RequireAccess from '../access/RequireAccess';
import { isAuthorIdAdmin } from '../access/utils';
import { roleLabel, skipLabel } from '../guidelines';
import { useClaimTexts, usePrefetchTasks, useTasks } from '../hooks';
import type { ExtractedName, SavedAnswer, TaskSummary } from '../types';
import { dateOf, FIELD, nameCandidates } from '../utils';
import { Trans } from 'react-i18next';
import { useT } from '../i18n';

type Tab = 'todo' | 'done';
type Row = TaskSummary & { number: number };

const TABS: { key: Tab; label: string }[] = [
  { key: 'todo', label: 'queue.todo' },
  { key: 'done', label: 'queue.done' },
];

const ANSWER = {
  inBdrc: { label: 'answer.inBdrc', style: 'bg-green-50 text-green-700' },
  notInBdrc: { label: 'answer.notInBdrc', style: 'bg-amber-50 text-amber-800' },
  skipped: { label: 'queue.skipped', style: 'bg-gray-100 text-gray-600' },
};

/** "In BDRC" when someone of the answer is; "not in BDRC" when only named. */
const answerType = (answer: SavedAnswer) => {
  if (answer.kind === 'skipped') return ANSWER.skipped;
  return answer.persons.some((p) => p.inBdrc) ? ANSWER.inBdrc : ANSWER.notInBdrc;
};

const pathOf = (row: { id: string }) => `/author-identification/${row.id}`;

function matches(row: Row, needle: string): boolean {
  const { answer } = row;
  const words = [row.title, row.id, String(row.number), ...row.extractedNames.map((n) => n.name)];
  if (answer?.kind === 'persons') for (const p of answer.persons) words.push(p.name, p.inBdrc ? p.personId : '');
  return words.some((w) => w?.toLowerCase().includes(needle));
}

export default function Queue() {
  return (
    <RequireAccess>
      <MyTexts />
    </RequireAccess>
  );
}

function MyTexts() {
  const t = useT();
  const me = useAuthorIdMe();
  const tasks = useTasks();
  usePrefetchTasks(tasks.data);
  // In the URL, so "back" from a text returns to the same tab.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'done' ? 'done' : 'todo';
  const [q, setQ] = useState('');

  // Numbered over all my texts, so a text keeps its number when it is done.
  const all = useMemo<Row[]>(() => (tasks.data ?? []).map((task, i) => ({ ...task, number: i + 1 })), [tasks.data]);
  const lists: Record<Tab, Row[]> = { todo: all.filter((x) => !isDone(x)), done: all.filter(isDone) };
  const needle = q.trim().toLowerCase();
  const rows = needle ? lists[tab].filter((row) => matches(row, needle)) : lists[tab];
  const next = lists.todo[0];
  const done = lists.done.length;

  let emptyText = t(tab === 'todo' ? 'queue.allDone' : 'queue.noneDone');
  if (tab === 'todo' && all.length === 0) emptyText = t('queue.noTexts');
  if (needle) emptyText = t('queue.noMatch', { q: q.trim() });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('queue.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('queue.subtitle')}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {isAuthorIdAdmin(me.data) && (
            <Button asChild variant="outline" className="bg-white">
              <Link to="/author-identification-admin">
                <Settings /> {t('queue.admin')}
              </Link>
            </Button>
          )}
          <AssignWork waiting={lists.todo.length} disabled={tasks.isLoading || tasks.isError} />
          {next && (
            <Button asChild className="flex-1 bg-blue-600 text-white hover:bg-blue-700 sm:flex-none">
              <Link to={pathOf(next)}>
                {t(done > 0 ? 'queue.continue' : 'queue.start')} <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {all.length > 0 && <Progress done={done} total={all.length} />}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist" aria-label={t('queue.title')}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setParams(key === 'todo' ? {} : { tab: key }, { replace: true })}
              className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t(label)} <span className="tabular-nums text-gray-500">{lists[key].length}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('queue.searchLabel')}
          placeholder={t('queue.searchPlaceholder')}
          className={`w-full sm:w-72 ${FIELD}`}
        />
      </div>

      {tasks.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t('queue.loadFailed', { error: tasks.error.message })}</div>
      ) : (
        <>
          <Cards rows={rows} />
          <Table rows={rows} tab={tab} />
          {tasks.isLoading && <div className="h-40 animate-pulse rounded-lg bg-gray-100" />}
          {!tasks.isLoading && rows.length === 0 && (
            <p className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500">{emptyText}</p>
          )}
        </>
      )}
    </div>
  );
}

const isDone = (t: TaskSummary) => t.answer != null || t.completed;

/** Gives me 5 more texts, as the Deduplicator does; only once mine are all done. */
function AssignWork({ waiting, disabled }: Readonly<{ waiting: number; disabled: boolean }>) {
  const t = useT();
  const claim = useClaimTexts();
  const assign = async () => {
    try {
      const { claimed } = await claim.mutateAsync();
      if (claimed > 0) toast.success(t('queue.added', { count: claimed }));
      else toast.info(t('queue.noneLeft'));
    } catch (e) {
      toast.error(t('queue.claimFailed', { error: e instanceof Error ? e.message : t('panel.tryAgain') }));
    }
  };
  const busy = waiting > 0;
  return (
    <Button
      variant={busy ? 'outline' : 'default'}
      className={`flex-1 cursor-pointer sm:flex-none ${busy ? 'bg-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
      disabled={disabled || busy || claim.isPending}
      title={busy ? t('queue.finishFirst') : undefined}
      onClick={() => void assign()}
    >
      <Inbox /> {t(claim.isPending ? 'queue.assigning' : 'queue.assignWork')}
    </Button>
  );
}

function Progress({ done, total }: Readonly<{ done: number; total: number }>) {
  const t = useT();
  return (
    <div className="mb-5 flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={t('queue.textsDone')}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200"
      >
        <div className="h-full rounded-full bg-green-600 transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <span className="shrink-0 text-sm tabular-nums text-gray-600">
        <Trans t={t} i18nKey="queue.progress" values={{ done, total }} components={{ b: <span className="font-semibold text-gray-900" /> }} />
      </span>
    </div>
  );
}

function Table({ rows, tab }: Readonly<{ rows: Row[]; tab: Tab }>) {
  const t = useT();
  const navigate = useNavigate();
  if (rows.length === 0) return null;

  return (
    <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm sm:block">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="w-16 px-4 py-3 font-medium">{t('queue.colNo')}</th>
            <th className="px-4 py-3 font-medium">{t('queue.colText')}</th>
            <th className="w-[34%] px-4 py-3 font-medium">{t(tab === 'todo' ? 'queue.colNames' : 'queue.colAnswer')}</th>
            {tab === 'done' && <th className="hidden w-32 px-4 py-3 font-medium lg:table-cell">{t('queue.colAnswered')}</th>}
            <th className="w-28 px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} onClick={() => navigate(pathOf(row))} className="cursor-pointer transition-colors hover:bg-gray-50">
              <td className="px-4 py-4 tabular-nums text-gray-500">{row.number}</td>
              <td className="px-4 py-4">
                <div className="truncate font-monlam text-base leading-loose text-gray-900" title={row.title}>
                  {row.title}
                </div>
                <div className="text-xs text-gray-500">{t('queue.versions', { count: row.versionCount })}</div>
              </td>
              <td className="px-4 py-4"><RowStatus row={row} /></td>
              {tab === 'done' && (
                <td className="hidden whitespace-nowrap px-4 py-4 text-gray-600 lg:table-cell">{row.answer && dateOf(row.answer.savedAt)}</td>
              )}
              <td className="px-4 py-4 text-right">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className={isDone(row) ? 'border-gray-300 bg-white text-gray-600' : 'border-blue-300 bg-white text-blue-700 hover:bg-blue-50 hover:text-blue-800'}
                >
                  {/* The row opens the text too; once is enough. */}
                  <Link to={pathOf(row)} aria-label={t(isDone(row) ? 'queue.viewTitle' : 'queue.openTitle', { title: row.title })} onClick={(e) => e.stopPropagation()}>
                    <OpenLabel done={isDone(row)} />
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The table, on a phone. */
function Cards({ rows }: Readonly<{ rows: Row[] }>) {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-2 sm:hidden">
      {rows.map((row) => (
        <li key={row.id}>
          <Link to={pathOf(row)} className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm active:bg-gray-50">
            <span className="flex justify-between gap-2 text-xs tabular-nums text-gray-500">
              <span>{t('queue.number', { n: row.number })}</span>
              <span>{t('queue.versions', { count: row.versionCount })}</span>
            </span>
            <span className="mt-1 block break-words font-monlam text-base leading-loose text-gray-900">{row.title}</span>
            <span className="mt-2 flex items-end justify-between gap-3">
              <span className="min-w-0"><RowStatus row={row} /></span>
              <span className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium ${isDone(row) ? 'text-gray-600' : 'text-blue-700'}`}>
                <OpenLabel done={isDone(row)} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OpenLabel({ done }: Readonly<{ done: boolean }>) {
  const t = useT();
  return done ? (
    <>
      <Eye className="h-3.5 w-3.5" /> {t('queue.view')}
    </>
  ) : (
    <>
      {t('queue.open')} <ArrowRight className="h-3.5 w-3.5" />
    </>
  );
}

/** The first name found in the text and its versions, and how many others. */
function NamesFound({ names }: Readonly<{ names: ExtractedName[] }>) {
  const t = useT();
  const [first, ...others] = nameCandidates(names);
  if (!first) return <span className="text-gray-400">{t('queue.noName')}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2">
      <span className="min-w-0 break-words font-monlam text-sm leading-relaxed text-gray-900">{first.name}</span>
      {others.length > 0 && (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 text-xs font-medium leading-5 text-amber-900">{t('queue.otherNames', { count: others.length })}</span>
      )}
    </span>
  );
}

function RowStatus({ row }: Readonly<{ row: Row }>) {
  const t = useT();
  if (row.answer) return <Answer answer={row.answer} />;
  if (row.completed) return <span className="inline-block rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">{t('queue.answered')}</span>;
  return <NamesFound names={row.extractedNames} />;
}

function Answer({ answer }: Readonly<{ answer: SavedAnswer }>) {
  const t = useT();
  const { label, style } = answerType(answer);
  return (
    <span className="block min-w-0">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>{t(label)}</span>
      {answer.kind === 'skipped' && <span className="mt-1 block text-sm text-gray-600">{skipLabel(answer.reason)}</span>}
      {answer.kind === 'persons' &&
        answer.persons.map((p, i) => (
          <span key={`${p.name}-${i}`} className="mt-1 block break-words font-monlam text-sm leading-relaxed text-gray-900">
            {p.name}
            {p.inBdrc && <span className="ml-2 font-sans text-xs text-gray-500">{p.personId}</span>}
            {p.role !== 'author' && <span className="ml-2 font-sans text-xs text-gray-500">· {roleLabel(p.role)}</span>}
          </span>
        ))}
      {answer.note && (
        <span className="mt-0.5 block truncate text-xs text-gray-500" title={answer.note}>
          {t('queue.note', { note: answer.note })}
        </span>
      )}
    </span>
  );
}
