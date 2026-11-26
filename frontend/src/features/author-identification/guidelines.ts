// From the Author Identification annotation guideline (Kaldan, 25 Nov 2026).

/**
 * Why a text is skipped. The first two are problems of the text itself: BDRC gets them as
 * a rejected text with that reason. "Author unknown" is sent as "I don't know".
 */
export const SKIP_REASONS = [
  { id: 'text_not_clean', label: 'Text is not clean' },
  { id: 'text_not_cropped', label: 'Text is not cropped properly' },
  { id: 'author_unknown', label: 'Author unknown at all' },
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number]['id'];

export const isSkipReason = (value: string | null | undefined): value is SkipReason =>
  SKIP_REASONS.some((r) => r.id === value);

export const skipLabel = (reason: SkipReason) => SKIP_REASONS.find((r) => r.id === reason)?.label ?? reason;

/** Confidence, 1 to 5, as BDRC takes it. The guideline's High / Medium / Low are 5, 3 and 1. */
export const CONFIDENCE = [
  { value: 1, hint: 'Only clues' },
  { value: 2, hint: '' },
  { value: 3, hint: 'Fairly sure' },
  { value: 4, hint: '' },
  { value: 5, hint: 'Name clearly written in the text' },
] as const;

/** BDRC's own guidelines, when they are on a page of theirs; else our guidelines page is shown. */
export const GUIDELINES_URL: string | null = null;

export const GUIDELINES_PATH = '/author-identification/guidelines';
