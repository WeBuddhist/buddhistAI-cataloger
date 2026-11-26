import { BookOpen } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { GUIDELINES_PATH, GUIDELINES_URL } from '../guidelines';
import { useT } from '../i18n';

/** The guidelines, in a new tab so that the text stays open; they lead back to this text. */
export default function GuidelinesLink() {
  const t = useT();
  const { pathname } = useLocation();
  const to = GUIDELINES_URL ?? `${GUIDELINES_PATH}?from=${encodeURIComponent(pathname)}`;
  return (
    <Link
      to={to}
      target="_blank"
      // Same site: kept, so "Back to the text" there can close the tab and return here.
      rel="opener"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 underline underline-offset-4 hover:text-blue-800"
    >
      <BookOpen className="h-4 w-4" aria-hidden /> {t('guidelinesLink')}
    </Link>
  );
}
