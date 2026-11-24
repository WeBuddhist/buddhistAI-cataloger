import type { ReactNode } from 'react';
import { useUser } from '@/hooks/useUser';
import { hasAuthorIdAccess } from './utils';

/** Shows its children to people with access to Author Identification only. */
export default function RequireAccess({ children }: { readonly children: ReactNode }) {
  const { user, isLoading, error } = useUser();

  if (error) return <div className="p-8 text-sm text-red-700">Could not check your access: {error.message}</div>;
  if (isLoading || !user) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (!hasAuthorIdAccess(user)) {
    return (
      <div className="p-8 text-sm text-gray-600">
        You don't have access to Author Identification. Ask an admin to give you the <code>author_identification</code>{' '}
        permission.
      </div>
    );
  }
  return children;
}
