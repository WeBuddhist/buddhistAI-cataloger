import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import RequireAccess from '../access/RequireAccess';
import AuthorPanel, { type AnswerKind } from '../components/AuthorPanel';
import SourceViewer, { type SourceTab } from '../components/SourceViewer';
import TextView from '../components/TextView';
import { useRemoveAnswer, useTask, useTasks } from '../hooks';
import type { AuthorTask, TaskSummary } from '../types';
import { cleanName, nameCandidates } from '../utils';

const ROOT = '/author-identification';

export default function Workspace() {
  return (
    <RequireAccess>
      <TextPage />
    </RequireAccess>
  );
}

function TextPage() {
  const { textId = '' } = useParams<{ textId: string }>();
  const tasks = useTasks();
  const task = useTask(textId);

  const error = tasks.error ?? task.error;
  if (error) {
    return (
      <div className="p-8 text-sm text-red-700">
        Could not load this text: {error.message}.{' '}
        <Link to={ROOT} className="underline">
          Back to my texts
        </Link>
      </div>
    );
  }
  if (!tasks.data || !task.data) return <div className="p-8 text-sm text-gray-500">Loading text…</div>;

  // Keyed so another text starts from fresh state.
  return <WorkspaceView key={task.data.id} task={task.data} tasks={tasks.data} />;
}

function WorkspaceView({ task, tasks }: Readonly<{ task: AuthorTask; tasks: TaskSummary[] }>) {
  const navigate = useNavigate();
  const undo = useRemoveAnswer();
  const index = tasks.findIndex((t) => t.id === task.id);
  const saved = tasks[index]?.answer ?? null;
  const candidates = useMemo(() => nameCandidates(task.extractedNames), [task.extractedNames]);
  const predicted = candidates[0]?.name ?? '';

  const [tab, setTab] = useState<SourceTab>('text');
  const [versionId, setVersionId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(
    () => task.extractedNames.find((n) => n.versionId == null)?.evidence ?? null,
  );
  const [focusEvidence, setFocusEvidence] = useState(0);
  const [query, setQuery] = useState(predicted);
  // The first name is searched straight away; nobody is picked for the annotator.
  const [searched, setSearched] = useState(predicted);
  const [kind, setKind] = useState<AnswerKind>(saved?.kind ?? 'person');
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

  const takeBack = async () => {
    try {
      await undo.mutateAsync(task.id);
      goTo(task.id);
    } catch {
      toast.error('Could not undo. Open the text again to change the answer.');
    }
  };
  // On to the next text without an answer, from here and then from the top; the list when
  // that was the last one.
  const afterFirstAnswer = () => {
    const open = [...tasks.slice(index + 1), ...tasks.slice(0, index)].find((t) => !t.answer);
    if (open) goTo(open.id);
    else navigate(ROOT);
    toast.success(open ? 'Answer saved' : 'Answer saved. That was your last text.', {
      // Not at the bottom right, where it would cover Submit on the next text.
      position: 'top-center',
      action: { label: 'Undo', onClick: () => void takeBack() },
    });
  };

  return (
    // 65px: the navigation bar and its border.
    <div className="flex min-h-[calc(100dvh-65px)] flex-col bg-white text-base lg:h-[calc(100dvh-65px)]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-200 px-4 py-2">
        <Link to={ROOT} className="inline-flex shrink-0 items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> My texts
        </Link>
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <h1 className="truncate font-monlam text-base leading-loose text-gray-900" title={task.title}>
            {task.title}
          </h1>
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">{task.id}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm tabular-nums text-gray-500">
            {index + 1} of {tasks.length}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Previous text" title="Previous text" className="cursor-pointer bg-white" disabled={!prevId} onClick={() => goTo(prevId)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next text" title="Next text" className="cursor-pointer bg-white" disabled={!nextId} onClick={() => goTo(nextId)}>
            <ChevronRight />
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="h-[75dvh] min-h-0 lg:h-auto">
          <SourceViewer
            tab={tab}
            onTabChange={setTab}
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
