import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import RequireAccess from '../access/RequireAccess';
import { SKIP_REASONS } from '../guidelines';

/** PLACEHOLDER until BDRC sends its guidelines. */
export default function Guidelines() {
  return (
    <RequireAccess>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/author-identification" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> My texts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Guidelines</h1>
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          The guidelines are not here yet. They will be added when BDRC sends them.
        </p>
        <h2 className="mt-6 text-base font-semibold text-gray-900">When to skip a text</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
          {SKIP_REASONS.map((r) => (
            <li key={r.id}>{r.label}</li>
          ))}
        </ul>
      </div>
    </RequireAccess>
  );
}
