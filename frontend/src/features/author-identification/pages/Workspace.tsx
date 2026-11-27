import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import RequireAccess from '../access/RequireAccess';
import AuthorPanel, { type PanelStep } from '../components/AuthorPanel';
import GuidelinesLink from '../components/GuidelinesLink';
import SourceViewer, { type SourceTab } from '../components/SourceViewer';
import TextView from '../components/TextView';
import { usePrefetchTasks, useTask, useTasks } from '../hooks';
import type { AuthorTask, TaskSummary } from '../types';
import { cleanName, nameCandidates } from '../utils';
import { useT } from '../i18n';

const ROOT = '/author-identification';

export default function Workspace() {
  return (
    <RequireAccess>
      <TextPage />
    </RequireAccess>
  );
}

function TextPage() {
  // A text is a BDRC batch item: /author-identification/<batch>/<item>.
  const t = useT();
  const { batchId = '', itemId = '' } = useParams<{ batchId: string; itemId: string }>();
  const textId = `${batchId}/${itemId}`;
  const tasks = useTasks();
  const task = useTask(textId);
  // The others, so going on to the next one is at once.
  usePrefetchTasks(tasks.data);

  const error = tasks.error ?? task.error;
  if (error) {
    return (
      <div className="p-8 text-sm text-red-700">
        {t('workspace.loadFailed', { error: error.message })}{' '}
        <Link to={ROOT} className="underline">
          {t('workspace.backToList')}
        </Link>
      </div>
    );
  }
  if (!tasks.data || !task.data) return <LoadingSkeleton />;
  if (!tasks.data.some((x) => x.id === textId)) {
    return (
      <div className="p-8 text-sm text-gray-700">
        {t('workspace.notYours')}{' '}
        <Link to={ROOT} className="text-blue-600 underline">
          {t('workspace.backToList')}
        </Link>
      </div>
    );
  }

  // Keyed so another text starts from fresh state.
  return <WorkspaceView key={task.data.id} task={task.data} tasks={tasks.data} />;
}

function WorkspaceView({ task, tasks }: Readonly<{ task: AuthorTask; tasks: TaskSummary[] }>) {
  const t = useT();
  const navigate = useNavigate();
  const index = tasks.findIndex((x) => x.id === task.id);
  const saved = tasks[index]?.answer ?? null;
  const candidates = useMemo(() => nameCandidates(task.extractedNames), [task.extractedNames]);
  const predicted = candidates[0]?.name ?? '';

  const [tab, setTab] = useState<SourceTab>('text');
  // Focus mode of the versions: the BDRC page takes all the room on the left.
  const [focus, setFocus] = useState(false);
  const focused = focus && tab === 'versions';
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(
    () => task.extractedNames.find((n) => n.versionId == null)?.evidence ?? null,
  );
  const [focusEvidence, setFocusEvidence] = useState(0);
  const [query, setQuery] = useState(predicted);
  // The first name is searched straight away; nobody is picked for the annotator.
  const [searched, setSearched] = useState(predicted);
  // A saved skip opens on step 2, where it was given; persons on the search, with their list.
  const [kind, setKind] = useState<PanelStep>(saved?.kind === 'skipped' ? 'skipped' : 'person');
  const [editing, setEditing] = useState(saved == null);

  const prevId = tasks[index - 1]?.id;
  const nextId = tasks[index + 1]?.id;
  const goTo = (id: string) => navigate(`${ROOT}/${id}`);

  const search = (name: string) => {
    const clean = cleanName(name);
    setQuery(clean);
    setSearched(clean);
    // A name can be searched from the text too, whatever the author panel is showing.
    setKind('person');
    setEditing(true);
  };
  const showVersion = (id: string) => {
    setVersionId(id);
    setTab('versions');
  };
  const showEvidence = (quote: string) => {
    setTab('text');
    setEvidence(quote);
    setFocusEvidence((n) => n + 1);
  };

  // On to the next text without an answer, from here and then from the top; the list when
  // that was the last one.
  const afterFirstAnswer = () => {
    const open = [...tasks.slice(index + 1), ...tasks.slice(0, index)].find((x) => !x.answer && !x.completed);
    if (open) goTo(open.id);
    else navigate(ROOT);
    toast.success(t(open ? 'workspace.saved' : 'workspace.savedLast'), {
      // Not at the bottom right, where it would cover Submit on the next text.
      position: 'top-center',
    });
  };

  return (
    // 65px: the navigation bar and its border.
    <div className="flex min-h-[calc(100dvh-65px)] flex-col bg-white text-base lg:h-[calc(100dvh-65px)]">
      <header className={focused ? 'hidden' : 'flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-200 px-4 py-2'}>
        <Link to={ROOT} className="inline-flex shrink-0 items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> {t('common.myTexts')}
        </Link>
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <h1 className="truncate font-monlam text-base leading-loose text-gray-900" title={task.title}>
            {task.title}
          </h1>
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600" title={t('workspace.bdrcId')}>
            {task.editionId}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* In sight at every step, and in one place only. */}
          <GuidelinesLink />
          <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden />
          <span className="text-sm tabular-nums text-gray-500">
            {t('workspace.position', { n: index + 1, total: tasks.length })}
          </span>
          <Button variant="outline" size="icon-sm" aria-label={t('workspace.previous')} title={t('workspace.previous')} className="cursor-pointer bg-white" disabled={!prevId} onClick={() => goTo(prevId)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label={t('workspace.next')} title={t('workspace.next')} className="cursor-pointer bg-white" disabled={!nextId} onClick={() => goTo(nextId)}>
            <ChevronRight />
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="h-[75dvh] min-h-0 lg:h-auto">
          <SourceViewer
            tab={tab}
            onTabChange={setTab}
            focus={focus}
            onFocusChange={setFocus}
            task={task}
            versionId={versionId}
            onVersionChange={setVersionId}
            onSearchName={search}
          >
            <TextView
              content={task.content}
              evidence={evidence}
              focusEvidence={focusEvidence}
              onSearchName={search}
            />
          </SourceViewer>
        </main>
        <div className="min-h-0 border-t border-gray-200 lg:border-l lg:border-t-0">
          <AuthorPanel
            taskId={task.id}
            editionId={task.editionId}
            taskTitle={task.title}
            candidates={candidates}
            versions={task.versions}
            saved={saved}
            kind={kind}
            onKindChange={setKind}
            editing={editing}
            onEditingChange={setEditing}
            query={query}
            searched={searched}
            onQueryChange={setQuery}
            onSearch={search}
            onShowEvidence={showEvidence}
            onShowVersion={showVersion}
            onShowVersions={() => setTab('versions')}
            onSaved={afterFirstAnswer}
            onNext={nextId ? () => goTo(nextId) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

/** The page's shape while a text loads (a long text takes a few seconds the first time). */
function LoadingSkeleton() {
  const t = useT();
  const bar = 'animate-pulse rounded bg-gray-200';
  return (
    <div role="status" aria-label={t('workspace.loading')} className="flex min-h-[calc(100dvh-65px)] flex-col bg-white lg:h-[calc(100dvh-65px)]">
      <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-3">
        <div className={`${bar} h-4 w-20`} />
        <div className={`${bar} h-5 max-w-md flex-1`} />
        <div className={`${bar} ml-auto h-7 w-24`} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4 px-6 py-6">
          <div className={`${bar} h-8 w-48`} />
          {[92, 100, 96, 88, 100, 94, 70, 98, 90, 85].map((w, i) => (
            <div key={i} className={`${bar} mx-auto h-4 max-w-3xl`} style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="space-y-4 border-t border-gray-200 px-4 py-4 lg:border-l lg:border-t-0">
          <div className={`${bar} h-28 w-full`} />
          <div className={`${bar} h-9 w-full`} />
          <div className={`${bar} h-10 w-full`} />
          <div className={`${bar} h-24 w-full`} />
        </div>
      </div>
      <span className="sr-only">{t('workspace.loadingDots')}</span>
    </div>
  );
}
