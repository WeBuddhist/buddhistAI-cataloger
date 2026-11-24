import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimplePagination } from '@/components/ui/simple-pagination';
import AvatarWrapper from '@/components/AvatarWrapper';
import { useUser } from '@/hooks/useUser';
import type { AuthorIdRole, Member, MemberFilter } from '../access/api';
import { useMembers, useUpdateMember } from '../access/hooks';
import { ROLE_LABEL } from '../access/utils';

const PAGE_SIZE = 20;
const ROLES: AuthorIdRole[] = ['annotator', 'reviewer', 'admin'];
const TH = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6';
const TD = 'px-4 py-3 align-middle sm:px-6';

// Author Identification's own users page: its access and its role, each changed on its own.
// Never another tool's role, so one tool's admins are not this one's.
export default function AdminUsers() {
  const { user: currentUser } = useUser();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<MemberFilter | ''>('');
  const [page, setPage] = useState(1);
  const members = useMembers(q, role || undefined, page, PAGE_SIZE);
  const update = useUpdateMember();
  const users = members.data?.users ?? [];

  const save = async (user: Member, body: { access?: boolean; role?: AuthorIdRole }) => {
    try {
      await update.mutateAsync({ id: user.id, ...body });
    } catch (e) {
      toast.error(`Could not update ${user.name || user.email}: ${(e as Error).message}`);
    }
  };

  return (
    <div className="py-6">
      <p className="text-sm text-gray-600">
        Who can use Author Identification, and their role in it. Changing these doesn't touch a person's role in the
        other tools.
      </p>

      <form
        className="mt-4 mb-4 flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
          setPage(1);
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search by name or email…" className="h-9 sm:w-72" />
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as MemberFilter | '');
            setPage(1);
          }}
          className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm sm:w-44"
        >
          <option value="">Everyone</option>
          <option value="admin">Admins</option>
          <option value="reviewer">Reviewers</option>
          <option value="annotator">Annotators</option>
          <option value="none">No access</option>
        </select>
        <Button type="submit" className="h-9 cursor-pointer">
          Search
        </Button>
      </form>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={`${TH} w-full`}>User</th>
              <th className={TH}>Access</th>
              <th className={TH}>Role</th>
              <th className={`${TH} hidden md:table-cell`}>Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {members.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={4} className="px-6 py-3">
                    <div className="h-9 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))}
            {!members.isLoading && users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                  No users match.
                </td>
              </tr>
            )}
            {users.map((u) => {
              // The server refuses removing your own admin; don't offer it.
              const isMe = u.id === currentUser?.id;
              return (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className={`${TD} w-full max-w-0`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="shrink-0">{u.picture && <AvatarWrapper src={u.picture} alt={u.name || u.email} />}</div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">{u.name || u.email}</div>
                        {u.name && <div className="truncate text-sm text-gray-500">{u.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={u.access}
                        disabled={update.isPending || isMe}
                        onChange={(e) => void save(u, { access: e.target.checked })}
                        className="rounded border-gray-300"
                      />
                      Author Identification
                    </label>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <select
                      value={u.role}
                      disabled={update.isPending || !u.access || isMe}
                      title={isMe ? "You can't change your own role" : u.access ? undefined : 'Give access first'}
                      onChange={(e) => void save(u, { role: e.target.value as AuthorIdRole })}
                      className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${TD} hidden whitespace-nowrap text-sm text-gray-500 md:table-cell`}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(page > 1 || members.data?.has_next) && (
        <SimplePagination
          className="mt-4"
          canGoPrev={page > 1}
          canGoNext={!!members.data?.has_next}
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
          label=""
          isDisabled={members.isFetching}
        />
      )}
    </div>
  );
}
