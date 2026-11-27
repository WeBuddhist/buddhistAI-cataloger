import { useCallback, useEffect } from 'react';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { fetchAnnotators, fetchOverview, type Period } from './api/admin';
import { decideDuplicate, fetchDuplicates, removeDuplicate, reportDuplicate } from './api/duplicates';
import { fetchNames, fetchPersonImage, fetchPersonRecord, fetchTerms, isTerm, termFallback } from './api/personRecord';
import { fetchPersonWorks } from './api/personWorks';
import { searchPersons, suggestNames } from './api/persons';
import { claimTexts, fetchTask, fetchTasks, saveAnswer } from './api/tasks';
import { fetchVersionDetails } from './api/versions';
import type { AuthorAnswer, AuthorTask, TaskSummary } from './types';

const root = ['author-identification'] as const;

const keys = {
  tasks: [...root, 'tasks'] as const,
  duplicates: [...root, 'duplicates'] as const,
  overview: [...root, 'admin', 'overview'] as const,
  annotators: (period: Period) => [...root, 'admin', 'annotators', period] as const,
  task: (id: string) => [...root, 'task', id] as const,
  versionDetails: (id: string) => [...root, 'version-details', id] as const,
  person: (id: string) => [...root, 'person', id] as const,
  names: (ids: string[]) => [...root, 'names', ids] as const,
  terms: (ids: string[]) => [...root, 'terms', ids] as const,
  personWorks: (id: string) => [...root, 'person-works', id] as const,
  personImage: (wikidataId: string) => [...root, 'person-image', wikidataId] as const,
  persons: (name: string) => [...root, 'persons', name] as const,
  suggestions: (name: string) => [...root, 'suggestions', name] as const,
};

/** My texts with their answers. */
export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: fetchTasks });

// A text is big (up to 1 MB) and hardly changes while it is being worked on.
const TASK_STALE_MS = 30 * 60 * 1000;

const taskOptions = (id: string, known?: TaskSummary) =>
  queryOptions({
    queryKey: keys.task(id),
    queryFn: () => fetchTask(id, known?.editionId ? known : undefined),
    staleTime: TASK_STALE_MS,
    retry: false,
  });

/** One text; with what "My texts" knows of it, one request less. */
export function useTask(id: string) {
  const client = useQueryClient();
  const known = client.getQueryData<TaskSummary[]>(keys.tasks)?.find((t) => t.id === id);
  return useQuery(taskOptions(id, known));
}

/** Loads my texts still to do in the background, so opening one is at once. */
export function usePrefetchTasks(tasks: TaskSummary[] | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    for (const t of tasks ?? []) {
      if (!t.answer && !t.completed && t.editionId) void client.prefetchQuery(taskOptions(t.id, t));
    }
  }, [client, tasks]);
}

/** BDRC's details of a text's versions, by version id. */
export const useVersionDetails = (task: Pick<AuthorTask, 'id' | 'versions'>) =>
  useQuery({
    queryKey: keys.versionDetails(task.id),
    queryFn: ({ signal }) => fetchVersionDetails(task.versions, signal),
  });

export function useSaveAnswer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, editionId, answer }: { taskId: string; editionId: string; answer: AuthorAnswer }) =>
      saveAnswer(taskId, editionId, answer),
    // Awaited, so the next page opens on the list as it is now.
    onSuccess: () => client.invalidateQueries({ queryKey: keys.tasks }),
  });
}

/** "Assign work": my next texts. */
export function useClaimTexts() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: claimTexts,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.tasks }),
  });
}

/** BDRC persons with this name; nothing is asked while it is empty. */
export const usePersonSearch = (name: string) =>
  useInfiniteQuery({
    queryKey: keys.persons(name),
    queryFn: ({ pageParam, signal }) => searchPersons(name, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.persons.length, 0);
      return last.persons.length > 0 && loaded < last.total ? loaded : undefined;
    },
    enabled: name.length > 0,
  });

export const useNameSuggestions = (name: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.suggestions(name),
    queryFn: ({ signal }) => suggestNames(name, signal),
    enabled,
  });

/** Every report of a person who has two BDRC ids. */
/** The admins' overview; refreshed every minute while open. */
export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: fetchOverview, refetchInterval: 60_000 });

/** Each person's work in the period; refreshed every minute while open. */
export const useAnnotators = (period: Period) =>
  useQuery({ queryKey: keys.annotators(period), queryFn: () => fetchAnnotators(period), refetchInterval: 60_000, placeholderData: keepPreviousData });

export const useDuplicates = () => useQuery({ queryKey: keys.duplicates, queryFn: fetchDuplicates });

export function useReportDuplicate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: reportDuplicate,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.duplicates }),
  });
}

export function useRemoveDuplicate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: removeDuplicate,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.duplicates }),
  });
}

export function useDecideDuplicate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Parameters<typeof decideDuplicate>[1] }) => decideDuplicate(id, decision),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.duplicates }),
  });
}

/** Records hardly change, so going back and forth between results asks for each once. */
const RECORD_STALE_MS = 60 * 60 * 1000;

const personRecordOptions = (id: string) =>
  queryOptions({
    queryKey: keys.person(id),
    queryFn: ({ signal }) => fetchPersonRecord(id, signal),
    staleTime: RECORD_STALE_MS,
    retry: 1,
  });

const personWorksOptions = (id: string) =>
  infiniteQueryOptions({
    queryKey: keys.personWorks(id),
    queryFn: ({ pageParam, signal }) => fetchPersonWorks(id, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.works.length, 0);
      return last.works.length > 0 && loaded < last.total ? loaded : undefined;
    },
    staleTime: RECORD_STALE_MS,
    retry: 1,
  });

export const usePersonRecord = (id: string) => useQuery(personRecordOptions(id));

export const usePersonWorks = (id: string) => useInfiniteQuery(personWorksOptions(id));

/** Loads a person before they are opened, as their record takes a while to come. */
export function usePrefetchPerson() {
  const client = useQueryClient();
  return useCallback(
    (id: string) => {
      void client.prefetchQuery(personRecordOptions(id));
      void client.prefetchInfiniteQuery(personWorksOptions(id));
    },
    [client],
  );
}

/** Names of BDRC records by id, once they are there. */
export function useNames(ids: string[]) {
  const terms = ids.filter(isTerm);
  const records = ids.filter((id) => !isTerm(id));
  const recordNames = useQuery({
    queryKey: keys.names(records),
    queryFn: ({ signal }) => fetchNames(records, signal),
    enabled: records.length > 0,
    staleTime: RECORD_STALE_MS,
    retry: 1,
  });
  // Apart, so that the slow ones do not hold up the others.
  const termNames = useQuery({
    queryKey: keys.terms(terms),
    queryFn: ({ signal }) => fetchTerms(terms, signal),
    enabled: terms.length > 0,
    staleTime: RECORD_STALE_MS,
    retry: 1,
  });
  return {
    /** Undefined while it is loading; the id itself when BDRC has no name for it. */
    nameOf: (id: string): string | undefined => {
      const { data, isLoading } = isTerm(id) ? termNames : recordNames;
      if (isLoading) return undefined;
      return data?.[id] ?? (isTerm(id) ? termFallback(id) : id);
    },
  };
}

export const usePersonImage = (wikidataId: string | null) =>
  useQuery({
    queryKey: keys.personImage(wikidataId ?? ''),
    queryFn: ({ signal }) => fetchPersonImage(wikidataId ?? '', signal),
    enabled: wikidataId != null,
    staleTime: RECORD_STALE_MS,
    retry: false,
  });
