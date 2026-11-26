import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import RequireAccess from '../access/RequireAccess';
import { SKIP_REASONS } from '../guidelines';

/** The annotation guideline (Kaldan, 25 Nov 2026), as written. Opened in its own tab. */
export default function Guidelines() {
  return (
    <RequireAccess>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/author-identification" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> My texts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Author Identification: annotation guideline</h1>
        <p className="mt-1 text-sm text-gray-500">25 November 2026 · Kaldan</p>

        <ol className="mt-6 list-decimal space-y-3 pl-6 text-[15px] leading-relaxed text-gray-800 marker:font-semibold marker:text-gray-500">
          <Rule>
            Choose <b>only one</b> author for each text.
          </Rule>
          <Rule>
            <b>Commentary:</b> the author is the person who wrote the commentary, not the author of the original text.
          </Rule>
          <Rule>
            <b>Terma:</b> the author is the tertön.
          </Rule>
          <Rule>
            <b>No author, only a scribe (transcriber) named:</b> if you think the scribe is the author, choose them. In the note, write:{' '}
            <Quote>This person is named as the transcriber.</Quote>
          </Rule>
          <Rule>Choose the author from the BDRC list.</Rule>
          <Rule>
            <b>Same person listed twice:</b> choose one. Open the other one’s page, copy its person ID, and in the note write:{' '}
            <Quote>Duplicate of this author: [person ID]</Quote>
          </Rule>
          <Rule>
            <b>Author not in the list:</b> type the name yourself. In the note, add anything that could help, such as dates, teacher, monastery, or
            other names.
          </Rule>
          <Rule>
            <b>More than one possible author:</b> choose only the one you are 100% sure of. Write the other names in the note.
          </Rule>
          <Rule>
            Every time, give a <b>confidence rating</b>:
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <b>High</b> (5): the name is clearly written in the text.
              </li>
              <li>
                <b>Medium</b> (3): you are fairly sure.
              </li>
              <li>
                <b>Low</b> (1): you only have clues.
              </li>
            </ul>
          </Rule>
          <Rule>You can leave the note box empty. Only use it for information about the author.</Rule>
          <Rule>
            <b>Can’t decide?</b> Press <b>Skip</b> and choose a reason:
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {SKIP_REASONS.map((r) => (
                <li key={r.id}>{r.label}</li>
              ))}
            </ul>
          </Rule>
        </ol>
      </div>
    </RequireAccess>
  );
}

function Rule({ children }: Readonly<{ children: ReactNode }>) {
  return <li className="pl-1">{children}</li>;
}

function Quote({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-900">“{children}”</span>;
}
