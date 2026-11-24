// Cataloger /author-identification routes: who can use the tool, and their role in it.
import { API_URL } from '@/config/api';
import { fetchWithAccessToken } from '@/lib/fetchWithAccessToken';

const BASE = `${API_URL}/author-identification`;

export type AuthorIdRole = 'annotator' | 'reviewer' | 'admin';

/** My access and role (users.author_identification_role). */
export interface AuthorIdMe {
  access: boolean;
  role: AuthorIdRole;
}

/** A Cataloger account on the Users page. */
export interface Member {
  id: string;
  name: string | null;
  email: string;
  picture: string | null;
  created_at: string | null;
  access: boolean;
  role: AuthorIdRole;
}

export type MemberFilter = AuthorIdRole | 'none';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAccessToken(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const fetchMe = () => request<AuthorIdMe>('/me');

export const fetchMembers = (params: { q?: string; role?: MemberFilter; page: number; pageSize: number }) => {
  const q = new URLSearchParams({ page: String(params.page), page_size: String(params.pageSize) });
  if (params.q) q.set('q', params.q);
  if (params.role) q.set('role', params.role);
  return request<{ users: Member[]; has_next: boolean }>(`/admin/users?${q}`);
};

export const updateMember = (id: string, body: { access?: boolean; role?: AuthorIdRole }) =>
  request<Member>(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
