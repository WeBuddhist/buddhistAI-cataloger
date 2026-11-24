import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthorIdMe } from '../access/hooks';
import RequireAccess from '../access/RequireAccess';
import { isAuthorIdAdmin } from '../access/utils';
import { useTasks } from '../hooks';
import { answerLabel } from '../utils';

type Tab = 'todo' | 'done';

export default function Queue() {
  return (
    <RequireAccess>
      <MyTexts />
    </RequireAccess>
  );
}

function MyTexts() {
  const navigate = useNavigate();
  const me = useAuthorIdMe();
  const tasks = useTasks();
  const [tab, setTab] = useState<Tab>('todo');

  // Numbered over all my texts, so a text keeps its number when it is done.
  const numbered = useMemo(() => (tasks.data ?? []).map((task, i) => ({ ...task, number: i + 1 })), [tasks.data]);
  const lists = { todo: numbered.filter((t) => !t.answer), done: numbered.filter((t) => t.answer) };
  const rows = lists[tab];
  const next = lists.todo[0];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My texts</h1>
          <p className="mt-1 text-sm text-gray-600">Find who wrote each text.</p>
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
            <Button className="flex-1 cursor-pointer bg-blue-600 text-white hover:bg-blue-700 sm:flex-none" onClick={() => navigate(`/author-identification/${next.id}`)}>
              {lists.done.length > 0 ? 'Continue' : 'Start'} <ArrowRight />
            </Button>
          )}
        </div>
      </div>

      <div className="mb-3 inline-flex rounded-md bg-gray-100 p-1" role="tablist">
        {(['todo', 'done'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {key === 'todo' ? 'To do' : 'Done'} <span className="tabular-nums text-gray-500">{lists[key].length}</span>
          </button>
        ))}
      </div>

      {tasks.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load your texts: {tasks.error.message}</div>
      )}
      {!tasks.error && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {tasks.isLoading && <li className="h-16 animate-pulse bg-gray-50" />}
          {!tasks.isLoading && rows.length === 0 && (
            <li className="py-10 text-center text-sm text-gray-500">{tab === 'todo' ? 'No texts left to do.' : 'No texts done yet.'}</li>
          )}
          {rows.map((t) => (
            <li key={t.id}>
              <Link to={`/author-identification/${t.id}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-gray-50">
                <span className="w-6 shrink-0 text-sm tabular-nums text-gray-500">{t.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-monlam text-base leading-loose text-gray-900">{t.title}</span>
                  {t.answer && <span className="block break-words font-monlam text-sm leading-relaxed text-green-700">{answerLabel(t.answer)}</span>}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-blue-700">
                  {t.answer ? 'View' : 'Open'} <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
