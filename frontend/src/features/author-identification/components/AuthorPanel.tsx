import { useState } from 'react';
import { ArrowRight, Check, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { needsNote, SKIP_REASONS, type SkipReason } from '../guidelines';
import { useSaveAnswer } from '../hooks';
import type { AuthorAnswer, BdrcPerson, NameCandidate, SavedAnswer, TextVersion } from '../types';
import { answerLabel, cleanName, FIELD, sameName } from '../utils';
import GuidelinesLink from './GuidelinesLink';
import PersonSearch from './PersonSearch';

export type AnswerKind = AuthorAnswer['kind'];

const KINDS: { kind: AnswerKind; label: string }[] = [
  { kind: 'person', label: 'In BDRC' },
  { kind: 'not_in_bdrc', label: 'Not in BDRC' },
  { kind: 'skipped', label: 'Skip' },
];

const LINK = 'cursor-pointer font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline';

/** The picked person of a saved answer, so it can be changed without searching again. */
const savedPerson = (saved: SavedAnswer | null): BdrcPerson | null =>
  saved?.kind === 'person'
    ? { id: saved.personId, nameBo: saved.name, matchedName: null, dates: null }
    : null;

export default function AuthorPanel({
  taskId,
  taskTitle,
  candidates,
  versions,
  saved,
  kind,
  onKindChange,
  editing,
  onEditingChange,
  query,
  searched,
  onQueryChange,
  onSearch,
  onShowEvidence,
  onShowVersion,
  onShowVersions,
  onSaved,
  onNext,
}: Readonly<{
  taskId: string;
  taskTitle: string;
  /** The names found in the text and its versions. */
  candidates: NameCandidate[];
  versions: TextVersion[];
  saved: SavedAnswer | null;
  kind: AnswerKind;
  onKindChange: (kind: AnswerKind) => void;
  /** Off: the saved answer is shown instead of the form. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  query: string;
  searched: string;
  onQueryChange: (query: string) => void;
  onSearch: (name: string) => void;
  onShowEvidence: (evidence: string) => void;
  onShowVersion: (versionId: string) => void;
  onShowVersions: () => void;
  /** After a first answer; changing one stays on the text. */
  onSaved: () => void;
  /** To the next text; undefined on the last. */
  onNext?: () => void;
}>) {
  const save = useSaveAnswer();
  const [person, setPerson] = useState<BdrcPerson | null>(savedPerson(saved));
  const [name, setName] = useState(saved?.kind === 'not_in_bdrc' ? saved.name : '');
  const [reason, setReason] = useState<SkipReason | null>(saved?.kind === 'skipped' ? saved.reason : null);
  const [note, setNote] = useState(saved?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(Boolean(saved?.note));
  const noteNeeded = kind === 'skipped' && reason != null && needsNote(reason);

  const chooseKind = (next: AnswerKind) => {
    onKindChange(next);
    // What was searched is most likely the author's name; it can still be changed.
    if (next === 'not_in_bdrc' && !name) setName(cleanName(query));
  };

  const draft = (): AuthorAnswer | null => {
    const noted = { note: note.trim() };
    if (kind === 'skipped') return reason && !(noteNeeded && !noted.note) ? { kind, reason, ...noted } : null;
    if (kind === 'not_in_bdrc') return cleanName(name) ? { kind, name: cleanName(name), ...noted } : null;
    return person ? { kind, personId: person.id, name: person.nameBo, ...noted } : null;
  };
  const answer = draft();

  const submit = async () => {
    if (!answer) return;
    try {
      await save.mutateAsync({ taskId, answer });
    } catch {
      toast.error('Could not save the answer. Try again.', { position: 'top-center' });
      return;
    }
    if (saved) {
      onEditingChange(false);
      toast.success('Answer changed', { position: 'top-center' });
    } else {
      onSaved();
    }
  };

  if (saved && !editing) {
    return (
      <section aria-label="Author" className="flex h-full min-h-0 flex-col bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700">
            <Check className="h-4 w-4" /> Answer saved
          </div>
          <div>
            <div className="break-words font-monlam text-lg leading-loose text-gray-900">{answerLabel(saved)}</div>
            {saved.note && (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-600">
                <span className="font-medium text-gray-700">Note:</span> {saved.note}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 border-t border-gray-200 px-5 py-3">
          <Button variant="outline" className="h-10 flex-1 cursor-pointer bg-white" onClick={() => onEditingChange(true)}>
            Change answer
          </Button>
          {onNext && (
            <Button variant="outline" className="h-10 flex-1 cursor-pointer bg-white" onClick={onNext}>
              Next text <ArrowRight />
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Author" className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <NamesFound
          candidates={candidates}
          versions={versions}
          searched={kind === 'person' ? searched : ''}
          onSearch={onSearch}
          onShowEvidence={onShowEvidence}
          onShowVersion={onShowVersion}
          onShowVersions={onShowVersions}
        />

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900">Author</h2>
            <GuidelinesLink />
          </div>
          <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Author">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="tab"
                aria-selected={kind === k.kind}
                onClick={() => chooseKind(k.kind)}
                className={`cursor-pointer rounded-md px-2 py-2 text-sm font-medium transition-colors ${
                  kind === k.kind ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          {kind === 'person' && (
            <PersonSearch
              text={{ id: taskId, title: taskTitle }}
              query={query}
              searched={searched}
              onQueryChange={onQueryChange}
              onSearch={onSearch}
              onShowVersions={onShowVersions}
              selected={person}
              onSelect={setPerson}
            />
          )}
          {kind === 'not_in_bdrc' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">For an author you can name who is not in BDRC. Try other spellings in the search first.</p>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Author’s name in Tibetan</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} lang="bo" className={`h-11 font-monlam text-base md:text-base ${FIELD}`} />
              </label>
            </div>
          )}
          {kind === 'skipped' && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm text-gray-600">Why are you skipping this text?</legend>
              {SKIP_REASONS.map((r) => (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                    reason === r.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="skip-reason"
                    checked={reason === r.id}
                    onChange={() => setReason(r.id)}
                    className="h-4 w-4 shrink-0 accent-blue-600"
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </div>

      <div className="space-y-2.5 border-t border-gray-200 px-5 py-3">
        {noteOpen || noteNeeded ? (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{noteNeeded ? 'Write the reason' : 'Note (optional)'}</span>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={noteNeeded ? undefined : 'For example, the name of a co-author'}
              className={FIELD}
            />
          </label>
        ) : (
          <button type="button" onClick={() => setNoteOpen(true)} className={`inline-flex items-center gap-1 text-sm ${LINK}`}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add a note
          </button>
        )}
        <p className="truncate text-sm text-gray-600">
          Your answer:{' '}
          {answer ? <span className="font-monlam text-gray-900">{answerLabel(answer)}</span> : 'none yet'}
        </p>
        <div className="flex gap-2">
          {saved && (
            <Button variant="outline" className="h-11 cursor-pointer bg-white" onClick={() => onEditingChange(false)}>
              Cancel
            </Button>
          )}
          <Button
            className="h-11 flex-1 cursor-pointer bg-green-600 text-base text-white hover:bg-green-700"
            disabled={!answer || save.isPending}
            onClick={submit}
          >
            {save.isPending ? 'Saving…' : kind === 'skipped' ? 'Skip this text' : 'Submit'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The author names found in the text and its versions (BDRC's editions API), with where. */
function NamesFound({
  candidates,
  versions,
  searched,
  onSearch,
  onShowEvidence,
  onShowVersion,
  onShowVersions,
}: Readonly<{
  candidates: NameCandidate[];
  versions: TextVersion[];
  searched: string;
  onSearch: (name: string) => void;
  onShowEvidence: (evidence: string) => void;
  onShowVersion: (versionId: string) => void;
  onShowVersions: () => void;
}>) {
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/60 px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-sky-900">Names found in the texts</h2>
        {candidates.length > 1 && (
          <span className="ml-auto rounded-full bg-amber-100 px-2 text-xs font-medium leading-5 text-amber-900">{candidates.length} different names</span>
        )}
      </div>
      {candidates.length > 0 ? (
        <>
          <ul className="divide-y divide-sky-100">
            {candidates.map((c) => (
              <Candidate
                key={c.name}
                candidate={c}
                versions={versions}
                searched={searched === c.name}
                onSearch={() => onSearch(c.name)}
                onShowEvidence={onShowEvidence}
                onShowVersion={onShowVersion}
              />
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-500">A name found is not always the author. Please check.</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-gray-600">
          No name was found. Look for one at the end of the text, or{' '}
          <button type="button" onClick={onShowVersions} className={LINK}>
            check the versions
          </button>
          .
        </p>
      )}
    </div>
  );
}

const PLACE = 'cursor-pointer rounded-full border border-sky-200 bg-white px-2 text-xs font-medium leading-5 text-blue-700 hover:border-blue-400 hover:bg-blue-50';

function Candidate({
  candidate,
  versions,
  searched,
  onSearch,
  onShowEvidence,
  onShowVersion,
}: Readonly<{
  candidate: NameCandidate;
  versions: TextVersion[];
  /** The results below are for it. */
  searched: boolean;
  onSearch: () => void;
  onShowEvidence: (evidence: string) => void;
  onShowVersion: (versionId: string) => void;
}>) {
  const { name, found } = candidate;
  // A quote around the name; not the name itself again.
  const evidence = found.find((f) => f.evidence && !sameName(f.evidence, name))?.evidence;
  return (
    <li className="py-2 first:pt-1">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-monlam text-xl leading-loose text-gray-900">{name}</span>
      </div>
      {evidence && (
        <p className="break-words text-sm">
          <mark className="rounded bg-amber-200 px-0.5 font-monlam leading-loose text-gray-900">{evidence}</mark>
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-600">Found in</span>
        {found.map((f) => {
          if (f.versionId == null) {
            return (
              <button key="text" type="button" className={PLACE} title="Show in text" onClick={() => onShowEvidence(f.evidence ?? '')}>
                Text
              </button>
            );
          }
          const { versionId } = f;
          const index = versions.findIndex((v) => v.id === versionId);
          if (index < 0) return null;
          return (
            <button key={versionId} type="button" className={PLACE} title="Open this version" onClick={() => onShowVersion(versionId)}>
              Version {index + 1}
            </button>
          );
        })}
        {!searched && (
          <Button variant="outline" size="sm" className="ml-auto h-7 cursor-pointer bg-white" aria-label={`Search ${name}`} onClick={onSearch}>
            <Search /> Search
          </Button>
        )}
      </div>
    </li>
  );
}
