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
 * The role the chosen person had in the text, as the annotators asked (Emma) and as BDRC's
 * editions API lists them; "other" with the role in the annotator's words.
 */
export const PERSON_ROLES = ['author', 'commentator', 'terton', 'transcriber', 'oral_teacher', 'other'] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

/** BDRC's role codes (GET /editions/roles). */
export const ROLE_CODE: Record<PersonRole, string> = {
  author: 'R0ER0019',
  commentator: 'R0ER0014',
  terton: 'R0ER0025',
  transcriber: 'R0ER0024',
  oral_teacher: 'R0ER0032',
  other: 'other',
};

/** The role of a code; the main author's for none or one this tool doesn't know. */
export const roleOfCode = (code: string | null | undefined): PersonRole =>
  PERSON_ROLES.find((r) => ROLE_CODE[r] === code) ?? 'author';

/** In the language chosen (translations: authorIdentification.personRole.*). */
export const roleLabel = (role: PersonRole) => tr(`personRole.${role}`);

/** Confidence, 1 to 5, as BDRC takes it. The guideline's High / Medium / Low are 5, 3 and 1. */
export const CONFIDENCE = [1, 2, 3, 4, 5] as const;

/** What a level means, for 1, 3 and 5 (translations: authorIdentification.confidence.*); none for 2 and 4. */
export const confidenceHint = (value: number): string => ([1, 3, 5].includes(value) ? tr(`confidence.${value}`) : '');

/** BDRC's own guidelines, when they are on a page of theirs; else our guidelines page is shown. */
export const GUIDELINES_URL: string | null = null;

export const GUIDELINES_PATH = '/author-identification/guidelines';
