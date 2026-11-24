import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthorIdMe } from '../access/hooks';
import RequireAccess from '../access/RequireAccess';
import { isAuthorIdAdmin } from '../access/utils';
import { useTasks } from '../hooks';
import SampleNotice from '../sample/SampleNotice';
import type { AuthorPrediction, SavedAnswer, TaskSummary } from '../types';
import { dateOf } from '../utils';

type Tab = 'todo' | 'done';
type Row = TaskSummary & { number: number };

const TABS: { key: Tab; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'done', label: 'Done' },
];

const ANSWER: Record<SavedAnswer['kind'], { label: string; style: string }> = {
  person: { label: 'In BDRC', style: 'bg-green-50 text-green-700' },
  not_in_bdrc: { label: 'Not in BDRC', style: 'bg-amber-50 text-amber-800' },
  unknown: { label: 'I don’t know', style: 'bg-gray-100 text-gray-600' },
};

const pathOf = (row: { id: string }) => `/author-identification/${row.id}`;
const versionsLabel = (count: number) => `${count} ${count === 1 ? 'version' : 'versions'}`;

function matches(row: Row, needle: string): boolean {
  const { answer } = row;
  const words = [row.title, row.id, String(row.number), row.prediction?.name];
  if (answer && answer.kind !== 'unknown') words.push(answer.name);
  if (answer?.kind === 'person') words.push(answer.personId);
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
  const me = useAuthorIdMe();
  const tasks = useTasks();
  // In the URL, so "back" from a text returns to the same tab.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'done' ? 'done' : 'todo';
  const [q, setQ] = useState('');

  // Numbered over all my texts, so a text keeps its number when it is done.
  const all = useMemo<Row[]>(() => (tasks.data ?? []).map((task, i) => ({ ...task, number: i + 1 })), [tasks.data]);
  const lists: Record<Tab, Row[]> = { todo: all.filter((t) => !t.answer), done: all.filter((t) => t.answer) };
  const needle = q.trim().toLowerCase();
  const rows = needle ? lists[tab].filter((row) => matches(row, needle)) : lists[tab];
  const next = lists.todo[0];
  const done = lists.done.length;

  let emptyText = tab === 'todo' ? 'All your texts are done.' : 'No texts done yet.';
  if (tab === 'todo' && all.length === 0) emptyText = 'You have no texts yet.';
  if (needle) emptyText = `Nothing matches “${q.trim()}”.`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My texts</h1>
          <p className="mt-1 text-sm text-gray-600">Find who wrote each text and link it to their BDRC person.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {isAuthorIdAdmin(me.data) && (
            <Button asChild variant="outline" className="bg-white">
              <Link to="/author-identification-admin">
                <Settings /> Admin
              </Link>
            </Button>
          )}
          {next && (
            <Button asChild className="flex-1 bg-blue-600 text-white hover:bg-blue-700 sm:flex-none">
              <Link to={pathOf(next)}>
                {done > 0 ? 'Continue' : 'Start'} <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </div>

      <SampleNotice kind="answers" canClear={done > 0} />

      {all.length > 0 && <Progress done={done} total={all.length} />}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist" aria-label="My texts">
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
              {label} <span className="tabular-nums text-gray-500">{lists[key].length}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search my texts"
          placeholder="Search title, author or number"
          className="w-full bg-white sm:w-72"
        />
      </div>

      {tasks.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load your texts: {tasks.error.message}</div>
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

function Progress({ done, total }: Readonly<{ done: number; total: number }>) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div
        role="progressbar"
        aria-label="Texts done"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200"
      >
        <div className="h-full rounded-full bg-green-600 transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <span className="shrink-0 text-sm tabular-nums text-gray-600">
        <span className="font-semibold text-gray-900">{done}</span> of {total} done
      </span>
    </div>
  );
}

function Table({ rows, tab }: Readonly<{ rows: Row[]; tab: Tab }>) {
  const navigate = useNavigate();
  if (rows.length === 0) return null;

  return (
    <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm sm:block">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="w-16 px-4 py-3 font-medium">No.</th>
            <th className="px-4 py-3 font-medium">Text</th>
            <th className="w-[34%] px-4 py-3 font-medium">{tab === 'todo' ? 'Model prediction' : 'Your answer'}</th>
            {tab === 'done' && <th className="hidden w-32 px-4 py-3 font-medium lg:table-cell">Answered</th>}
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
                <div className="text-xs text-gray-500">{versionsLabel(row.versionCount)}</div>
              </td>
              <td className="px-4 py-4">{row.answer ? <Answer answer={row.answer} /> : <Prediction prediction={row.prediction} />}</td>
              {tab === 'done' && (
                <td className="hidden whitespace-nowrap px-4 py-4 text-gray-600 lg:table-cell">{row.answer && dateOf(row.answer.savedAt)}</td>
              )}
              <td className="px-4 py-4 text-right">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className={row.answer ? 'border-gray-300 bg-white text-gray-600' : 'border-blue-300 bg-white text-blue-700 hover:bg-blue-50 hover:text-blue-800'}
                >
                  {/* The row opens the text too; once is enough. */}
                  <Link to={pathOf(row)} aria-label={`${row.answer ? 'View' : 'Open'} ${row.title}`} onClick={(e) => e.stopPropagation()}>
                    <OpenLabel done={row.answer != null} />
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
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-2 sm:hidden">
      {rows.map((row) => (
        <li key={row.id}>
          <Link to={pathOf(row)} className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm active:bg-gray-50">
            <span className="flex justify-between gap-2 text-xs tabular-nums text-gray-500">
              <span>No. {row.number}</span>
              <span>{versionsLabel(row.versionCount)}</span>
            </span>
            <span className="mt-1 block break-words font-monlam text-base leading-loose text-gray-900">{row.title}</span>
            <span className="mt-2 flex items-end justify-between gap-3">
              <span className="min-w-0">{row.answer ? <Answer answer={row.answer} /> : <Prediction prediction={row.prediction} />}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium ${row.answer ? 'text-gray-600' : 'text-blue-700'}`}>
                <OpenLabel done={row.answer != null} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OpenLabel({ done }: Readonly<{ done: boolean }>) {
  return done ? (
    <>
      <Eye className="h-3.5 w-3.5" /> View
    </>
  ) : (
    <>
      Open <ArrowRight className="h-3.5 w-3.5" />
    </>
  );
}

function Prediction({ prediction }: Readonly<{ prediction: AuthorPrediction | null }>) {
  if (!prediction) return <span className="text-gray-400">No prediction</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-sky-700" aria-hidden />
      <span className="min-w-0 break-words font-monlam text-sm leading-relaxed text-gray-900">{prediction.name}</span>
      {prediction.confidence != null && (
        <span className="shrink-0 text-xs tabular-nums text-gray-500">{Math.round(prediction.confidence * 100)}%</span>
      )}
    </span>
  );
}

function Answer({ answer }: Readonly<{ answer: SavedAnswer }>) {
  const { label, style } = ANSWER[answer.kind];
  return (
    <span className="block min-w-0">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>{label}</span>
      {answer.kind !== 'unknown' && (
        <span className="mt-1 block break-words font-monlam text-sm leading-relaxed text-gray-900">
          {answer.name}
          {answer.kind === 'person' && <span className="ml-2 font-sans text-xs text-gray-500">{answer.personId}</span>}
        </span>
      )}
    </span>
  );
}
