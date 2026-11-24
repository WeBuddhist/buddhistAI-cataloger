import type { AuthorIdMe, AuthorIdRole } from './api';

/** Mirrors backend/author_identification/deps.py: the author_identification permission. */
export function hasAuthorIdAccess(user: { permissions?: string[] | null } | null | undefined): boolean {
  return user?.permissions?.includes('author_identification') ?? false;
}

/** The Users page: access plus role admin here, never another tool's role. */
export function isAuthorIdAdmin(me: AuthorIdMe | null | undefined): boolean {
  return !!me?.access && me.role === 'admin';
}

export const ROLE_LABEL: Record<AuthorIdRole, string> = {
  annotator: 'Annotator',
  reviewer: 'Reviewer',
  admin: 'Admin',
};
