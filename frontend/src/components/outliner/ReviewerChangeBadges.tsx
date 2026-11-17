import { useTranslation } from 'react-i18next';
import {
  hasReviewerAuthorCorrection,
  hasReviewerTitleCorrection,
  type ReviewerChangeSegment,
} from './reviewerChanges';

interface ReviewerChangeBadgesProps {
  readonly segment: ReviewerChangeSegment;
  /**
   * Also mark title/author corrections. On in the annotator workspace, where the annotator's own
   * title/author is shown and the reviewer's correction (kept separately) would otherwise be missed.
   */
  readonly showTitleAuthorCorrections?: boolean;
}

const badgeClass = 'px-2 py-0.5 rounded-full text-xs font-medium border';

/** Marks segments the reviewer added or split/merged during review (reviewer and annotator views). */
export function ReviewerChangeBadges({ segment, showTitleAuthorCorrections = false }: ReviewerChangeBadgesProps) {
  const { t } = useTranslation();
  return (
    <>
      {segment.created_by_id && (
        <span
          className={`${badgeClass} bg-emerald-100 text-emerald-800 border-emerald-300`}
          title={t('outliner.reviewerChange.addedHint')}
        >
          {t('outliner.reviewerChange.added')}
        </span>
      )}
      {segment.corrected_by_reviewer && (
        <span
          className={`${badgeClass} bg-amber-100 text-amber-800 border-amber-300`}
          title={t('outliner.reviewerChange.correctedHint')}
        >
          {t('outliner.reviewerChange.corrected')}
        </span>
      )}
      {showTitleAuthorCorrections && hasReviewerTitleCorrection(segment) && (
        <span
          className={`${badgeClass} bg-amber-100 text-amber-800 border-amber-300`}
          title={segment.reviewer_title?.trim() || t('outliner.reviewerSuggestion.emptyDisplay')}
        >
          {t('outliner.reviewerSuggestion.correctedTitle')}
        </span>
      )}
      {showTitleAuthorCorrections && hasReviewerAuthorCorrection(segment) && (
        <span
          className={`${badgeClass} bg-amber-100 text-amber-800 border-amber-300`}
          title={segment.reviewer_author?.trim() || t('outliner.reviewerSuggestion.emptyDisplay')}
        >
          {t('outliner.reviewerSuggestion.correctedAuthor')}
        </span>
      )}
    </>
  );
}
