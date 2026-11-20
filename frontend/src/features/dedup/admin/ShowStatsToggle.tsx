import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** The "Show stats" switch on a person's admin page. */
export default function ShowStatsToggle({ on, onChange }: Readonly<{ on: boolean; onChange: (on: boolean) => void }>) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      <BarChart3 className="h-4 w-4" />
      {t('dedup.admin.showStats')}
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-emerald-600' : 'bg-gray-300'}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
