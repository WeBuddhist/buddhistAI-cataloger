import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { decideDuplicate, fetchDuplicates, removeDuplicate, reportDuplicate } from './api/duplicates';
import { searchPersons, suggestNames } from './api/persons';
import { fetchTask, fetchTasks, removeAnswer, saveAnswer } from './api/tasks';
import { fetchVersionDetails } from './api/versions';
import type { AuthorAnswer, AuthorTask } from './types';

const root = ['author-identification'] as const;

const keys = {
  tasks: [...root, 'tasks'] as const,
  duplicates: [...root, 'duplicates'] as const,
  task: (id: string) => [...root, 'task', id] as const,
  versionDetails: (id: string) => [...root, 'version-details', id] as const,
  persons: (name: string) => [...root, 'persons', name] as const,
  suggestions: (name: string) => [...root, 'suggestions', name] as const,
};

/** My texts with their answers. */
export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: fetchTasks });

export const useTask = (id: string) => useQuery({ queryKey: keys.task(id), queryFn: () => fetchTask(id), retry: false });

/** BDRC's details of a text's versions, by version id. */
export const useVersionDetails = (task: Pick<AuthorTask, 'id' | 'versions'>) =>
  useQuery({
    queryKey: keys.versionDetails(task.id),
    queryFn: ({ signal }) => fetchVersionDetails(task.versions, signal),
  });

export function useSaveAnswer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, answer }: { taskId: string; answer: AuthorAnswer }) => saveAnswer(taskId, answer),
    // Awaited, so the next page opens on the list as it is now.
    onSuccess: () => client.invalidateQueries({ queryKey: keys.tasks }),
  });
}

export function useRemoveAnswer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => removeAnswer(taskId),
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
