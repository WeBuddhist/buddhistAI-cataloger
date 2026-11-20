import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PeriodFilter from '../admin/PeriodFilter';
import { ReviewStats } from '../components/AgreementStats';
import { usePeriod } from '../hooks/usePeriod';
import { useMyStats } from '../hooks/useReview';

// The annotator's own work: how many pairs they answered, and how often the other
// annotator gave the same answer. Nothing about who the other annotator or the
// adjudicator was.
export default function MyStats() {
  const { t } = useTranslation();
  const period = usePeriod();
  const stats = useMyStats(period.period);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link to="/dedup" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> {t('dedup.myStats.back')}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">{t('dedup.myStats.title')}</h1>
      <p className="mt-1 text-sm text-gray-600">{t('dedup.myStats.subtitle')}</p>

      <div className="mt-4">
        <PeriodFilter state={period} />
      </div>

      {stats.error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.myStats.loadFailed', { error: stats.error.message })}
        </div>
      )}
      {stats.isLoading && <div className="mt-6 h-64 animate-pulse rounded-xl bg-gray-100" />}

      {stats.data && (
        <div className={`mt-6 space-y-3 ${stats.isFetching ? 'opacity-70' : ''}`}>
          <ReviewStats pairs={stats.data} period={period} />
          <p className="text-xs text-gray-500">{t('dedup.myStats.howCounted')}</p>
        </div>
      )}
    </div>
  );
}
