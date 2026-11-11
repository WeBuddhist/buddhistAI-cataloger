import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useUser } from '@/hooks/useUser';
import CopyPairLink from '../components/CopyPairLink';
import FullTextDialog, { type FullTextView } from '../components/FullTextDialog';
import PairEvidence from '../components/PairEvidence';
import type { ScanTag } from '../components/ScanPanel';
import { useBatchName, useMyItems, usePair } from '../hooks/useReview';
import { dedupRole, hasDedupAccess } from '../utils';

// A pair opened from a shared link (e.g. a spreadsheet): the texts and scores only. No
// answer buttons and nobody's answer, so it is safe to share while a pair is still being
// reviewed, and clean for screenshots. Opens for any logged-in account.
// The annotator assigned to the pair is sent on to their own work page instead, where
// they see and can change their answer.
export default function PairView() {
  const { t } = useTranslation();
  const { itemId: itemIdParam } = useParams();
  const itemId = Number(itemIdParam);
  const pair = usePair(itemId);
  const batchName = useBatchName();
  const { user } = useUser();
  const myItems = useMyItems('all', undefined, hasDedupAccess(user) && dedupRole(user) !== 'reviewer');
  const isMine = Boolean(myItems.data?.some((it) => it.item_id === itemId));
  // Set when the work page sent us here (not this user's pair): never send it back.
  const fromWorkPage = Boolean((useLocation().state as { notMine?: boolean } | null)?.notMine);
  const [fullText, setFullText] = useState<FullTextView | null>(null);
  const [scan, setScan] = useState<ScanTag | null>(null);

  if (isMine && !fromWorkPage) {
    return <Navigate to={`/dedup/item/${itemId}`} replace />;
  }
  if (pair.isLoading || myItems.isLoading) {
    return <div className="py-24 text-center text-gray-500">{t('dedup.pairView.loading')}</div>;
  }
  if (pair.error || !pair.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.pairView.loadFailed', { id: itemIdParam, error: pair.error?.message ?? t('dedup.review.notFound') })}
        </div>
      </div>
    );
  }

  const p = pair.data;
  const cardA = p.evidence.a ?? { mw_id: p.subject.a_mw ?? '' };
  const cardB = p.evidence.b ?? { mw_id: p.subject.b_mw ?? '' };

  return (
    <div className={`mx-auto w-full ${scan ? 'max-w-none' : 'max-w-7xl'} px-4 pb-10 pt-4 sm:px-6 sm:pt-6 lg:px-8`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{t('dedup.pairView.title', { id: p.item_id })}</h1>
          <p className="text-xs text-gray-500" title={p.batch_id}>
            {batchName(p.batch_id)} · {t('dedup.pairView.readOnly')}
          </p>
        </div>
        <CopyPairLink itemId={p.item_id} />
      </div>

      <PairEvidence itemId={p.item_id} evidence={p.evidence} cardA={cardA} cardB={cardB} onFullText={setFullText} scan={scan} onScanChange={setScan} />

      {fullText && (
        <FullTextDialog a={cardA} b={cardB} itemId={p.item_id} view={fullText} onViewChange={setFullText} onClose={() => setFullText(null)} />
      )}
    </div>
  );
}
