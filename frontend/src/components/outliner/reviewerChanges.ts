/** Fields that record what the reviewer changed on a segment during review. */
export interface ReviewerChangeSegment {
  created_by_id?: string | null;
  corrected_by_reviewer?: boolean | null;
  title?: string | null;
  author?: string | null;
  reviewer_title?: string | null;
  reviewer_author?: string | null;
}

/** The reviewer set a title that differs from the annotator's (same rule as the "Corrected title" box). */
export function hasReviewerTitleCorrection(segment: ReviewerChangeSegment): boolean {
  if (segment.reviewer_title == null) return false;
  return segment.reviewer_title.trim() !== (segment.title ?? '').trim();
}

/** The reviewer set an author that differs from the annotator's ("" is a deliberate blank). */
export function hasReviewerAuthorCorrection(segment: ReviewerChangeSegment): boolean {
  if (segment.reviewer_author == null) return false;
  return segment.reviewer_author.trim() !== (segment.author ?? '').trim();
}

/** Any change the reviewer made to this segment: split/merge, added, or title/author corrected. */
export function hasAnyReviewerChange(segment: ReviewerChangeSegment): boolean {
  return Boolean(
    segment.corrected_by_reviewer ||
      segment.created_by_id ||
      hasReviewerTitleCorrection(segment) ||
      hasReviewerAuthorCorrection(segment)
  );
}
