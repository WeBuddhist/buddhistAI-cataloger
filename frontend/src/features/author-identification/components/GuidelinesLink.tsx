import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GUIDELINES_PATH, GUIDELINES_URL } from '../guidelines';

/** The guidelines, in a new tab so that the text stays open. */
export default function GuidelinesLink() {
  return (
    <Link
      to={GUIDELINES_URL ?? GUIDELINES_PATH}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 underline underline-offset-4 hover:text-blue-800"
    >
      <BookOpen className="h-4 w-4" aria-hidden /> View guidelines
    </Link>
  );
}
