import { useTranslation } from 'react-i18next';
import './tibetan.css';

/**
 * The classes of this tool's pages and dialogs: "ai-bo" in Tibetan, for its text sizes and
 * bold (tibetan.css). The site doesn't mark the page's language, so the tool does it here.
 * Dialogs open outside the page, so they carry it too.
 */
export function useToolScope(): string {
  const { i18n } = useTranslation();
  return (i18n.resolvedLanguage ?? i18n.language ?? '').startsWith('bo') ? 'ai-tool ai-bo' : 'ai-tool';
}
