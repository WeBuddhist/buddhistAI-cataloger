// The tool's own words, in the app's translation files under "authorIdentification" (English,
// Tibetan). BDRC's own data (titles, names, records) is shown as BDRC has it, untranslated.
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/config';

/** In components: `const t = useT(); t('queue.title')`. Follows the language menu. */
export function useT() {
  return useTranslation(undefined, { keyPrefix: 'authorIdentification' }).t;
}

/** Outside components (labels built on the fly, toasts): the current language at call time. */
export const tr = (key: string, options?: Record<string, unknown>): string =>
  i18n.t(`authorIdentification.${key}`, options) as string;
