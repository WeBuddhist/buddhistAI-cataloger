// Apart from ../hooks: the navigation uses these on every page, and must not load the
// workspace's search and Wylie converter with them.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { fetchMe, fetchMembers, updateMember, type AuthorIdRole, type MemberFilter } from './api';

const root = ['author-identification'] as const;

const keys = {
  me: [...root, 'me'] as const,
  allMembers: [...root, 'members'] as const,
  members: (q: string, role: string, page: number) => [...root, 'members', q, role, page] as const,
};

/** My access and role. Pass false to skip the request (e.g. no access). */
export function useAuthorIdMe(enabled = true) {
  const { isAuthenticated } = useAuth0();
  return useQuery({ queryKey: keys.me, queryFn: fetchMe, enabled: enabled && isAuthenticated });
}

export const useMembers = (q: string, role: MemberFilter | undefined, page: number, pageSize: number) =>
  useQuery({
    queryKey: keys.members(q, role ?? '', page),
    queryFn: () => fetchMembers({ q: q || undefined, role, page, pageSize }),
    placeholderData: keepPreviousData,
  });

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; access?: boolean; role?: AuthorIdRole }) => updateMember(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.allMembers });
      qc.invalidateQueries({ queryKey: keys.me });
      // The shared user record (nav, Settings) carries the permissions.
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  });
}
