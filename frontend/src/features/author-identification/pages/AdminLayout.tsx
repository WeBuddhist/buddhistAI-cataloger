import type { ReactNode } from 'react';
import { Link, NavLink, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthorIdMe } from '../access/hooks';
import { isAuthorIdAdmin } from '../access/utils';

const TABS = [
  { to: '/author-identification-admin/users', label: 'Users' },
  { to: '/author-identification-admin/duplicates', label: 'Duplicates' },
];

/** Admin pages of Author Identification: open to its own admins (users.author_identification_role). */
export default function AdminLayout({ children }: { readonly children: ReactNode }) {
  const me = useAuthorIdMe();
  if (me.isLoading) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (!isAuthorIdAdmin(me.data)) return <Navigate to="/author-identification" replace />;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
      <Link to="/author-identification" className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Author Identification
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-gray-900">Author Identification admin</h1>
      <nav className="mt-4 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                isActive ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
