// PLACEHOLDER until BDRC sends its guidelines. Only this file changes then.

/** Why a text can be skipped. */
export const SKIP_REASONS = [
  { id: 'unclear_text', label: 'The text is not clear' },
  { id: 'other', label: 'Another reason' },
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number]['id'];

/** Not one of the list, so the note has to say it. */
export const needsNote = (reason: SkipReason) => reason === 'other';

export const skipLabel = (reason: SkipReason) => SKIP_REASONS.find((r) => r.id === reason)?.label ?? reason;

/** BDRC's own guidelines, when they are on a page of theirs; else our guidelines page is shown. */
export const GUIDELINES_URL: string | null = null;

export const GUIDELINES_PATH = '/author-identification/guidelines';
