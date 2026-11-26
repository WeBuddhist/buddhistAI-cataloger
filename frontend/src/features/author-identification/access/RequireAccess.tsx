import type { ReactNode } from 'react';
import { useUser } from '@/hooks/useUser';
import { hasAuthorIdAccess } from './utils';
import { Trans } from 'react-i18next';
import { useT } from '../i18n';

/** Shows its children to people with access to Author Identification only. */
export default function RequireAccess({ children }: { readonly children: ReactNode }) {
  const t = useT();
  const { user, isLoading, error } = useUser();

  if (error) return <div className="p-8 text-sm text-red-700">{t('access.checkFailed', { error: error.message })}</div>;
  if (isLoading || !user) return <div className="p-8 text-sm text-gray-500">{t('common.loading')}</div>;
  if (!hasAuthorIdAccess(user)) {
    return (
      <div className="p-8 text-sm text-gray-600">
        <Trans t={t} i18nKey="access.none" components={{ code: <code /> }} />
      </div>
    );
  }
  return children;
}
