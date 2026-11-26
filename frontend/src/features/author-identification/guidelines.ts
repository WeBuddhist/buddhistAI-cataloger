// From the Author Identification annotation guideline (Kaldan, 25 Nov 2026).
import { tr } from './i18n';

/**
 * Why a text is skipped. The first two are problems of the text itself: BDRC gets them as
 * a rejected text with that reason. "Author unknown" is sent as "I don't know".
 */
export const SKIP_REASONS = [{ id: 'text_not_clean' }, { id: 'text_not_cropped' }, { id: 'author_unknown' }] as const;

export type SkipReason = (typeof SKIP_REASONS)[number]['id'];

export const isSkipReason = (value: string | null | undefined): value is SkipReason =>
  SKIP_REASONS.some((r) => r.id === value);

/** In the language chosen (translations: authorIdentification.skip.*). */
export const skipLabel = (reason: SkipReason) => tr(`skip.${reason}`);

/**
 * The role the chosen person had in the text, as the annotators asked (Emma; agreed by
 * Elie): the author, or the tertön of a terma, or only its scribe. "Other" is explained in
 * the note. Sent to BDRC in the answer's data, as `role`.
 */
export const PERSON_ROLES = ['author', 'terton', 'scribe', 'other'] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

export const isPersonRole = (value: unknown): value is PersonRole => PERSON_ROLES.includes(value as PersonRole);

/** In the language chosen (translations: authorIdentification.personRole.*). */
export const roleLabel = (role: PersonRole) => tr(`personRole.${role}`);

/** Confidence, 1 to 5, as BDRC takes it. The guideline's High / Medium / Low are 5, 3 and 1. */
export const CONFIDENCE = [1, 2, 3, 4, 5] as const;

/** What a level means, for 1, 3 and 5 (translations: authorIdentification.confidence.*); none for 2 and 4. */
export const confidenceHint = (value: number): string => ([1, 3, 5].includes(value) ? tr(`confidence.${value}`) : '');

/** BDRC's own guidelines, when they are on a page of theirs; else our guidelines page is shown. */
export const GUIDELINES_URL: string | null = null;

export const GUIDELINES_PATH = '/author-identification/guidelines';
