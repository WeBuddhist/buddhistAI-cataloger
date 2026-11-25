// MOCK: texts come from ../sample and answers stay in this browser. Nothing is sent
// anywhere. When the endpoints exist, only this file changes.
import { SAMPLE_TASKS } from '../sample/tasks';
import type { AuthorAnswer, AuthorTask, SavedAnswer, TaskSummary } from '../types';

const STORE = 'author-identification:sample-answers';

type Answers = Record<string, SavedAnswer | undefined>;

function readAnswers(): Answers {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

const writeAnswers = (answers: Answers) => localStorage.setItem(STORE, JSON.stringify(answers));

/** My texts, in the order to work through them. */
export async function fetchTasks(): Promise<TaskSummary[]> {
  const answers = readAnswers();
  return SAMPLE_TASKS.map(({ id, title, versions, extractedNames }) => ({
    id,
    title,
    versionCount: versions.length,
    extractedNames,
    answer: answers[id] ?? null,
  }));
}

export async function fetchTask(id: string): Promise<AuthorTask> {
  const task = SAMPLE_TASKS.find((t) => t.id === id);
  if (!task) throw new Error('Text not found');
  return task;
}

export async function saveAnswer(taskId: string, answer: AuthorAnswer): Promise<SavedAnswer> {
  const saved: SavedAnswer = { ...answer, savedAt: new Date().toISOString() };
  writeAnswers({ ...readAnswers(), [taskId]: saved });
  return saved;
}

/** Take an answer back: the text is to do again. */
export async function removeAnswer(taskId: string): Promise<void> {
  const answers = readAnswers();
  delete answers[taskId];
  writeAnswers(answers);
}

/** Only for trying the tool: every text is to do again. */
export async function clearSampleAnswers(): Promise<void> {
  localStorage.removeItem(STORE);
}
