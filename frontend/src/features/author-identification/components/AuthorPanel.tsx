import { useState } from 'react';
import { ArrowRight, Check, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSaveAnswer } from '../hooks';
import type { AuthorAnswer, BdrcPerson, NameCandidate, SavedAnswer, TextVersion } from '../types';
import { answerLabel, cleanName, FIELD } from '../utils';
import PersonSearch from './PersonSearch';

export type AnswerKind = AuthorAnswer['kind'];

const KINDS: { kind: AnswerKind; label: string }[] = [
  { kind: 'person', label: 'In BDRC' },
  { kind: 'not_in_bdrc', label: 'Not in BDRC' },
  { kind: 'unknown', label: 'I don’t know' },
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
  /** The names the model found. */
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
  const [note, setNote] = useState(saved && saved.kind !== 'person' ? saved.note : '');

  const chooseKind = (next: AnswerKind) => {
    onKindChange(next);
    // What was searched is most likely the author's name; it can still be changed.
    if (next === 'not_in_bdrc' && !name) setName(cleanName(query));
  };

  const draft = (): AuthorAnswer | null => {
    if (kind === 'unknown') return { kind, note: note.trim() };
    if (kind === 'not_in_bdrc') return cleanName(name) ? { kind, name: cleanName(name), note: note.trim() } : null;
    return person ? { kind, personId: person.id, name: person.nameBo } : null;
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
            {saved.kind !== 'person' && saved.note && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{saved.note}</p>}
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
        <ModelPrediction
          candidates={candidates}
          versions={versions}
          searched={kind === 'person' ? searched : ''}
          onSearch={onSearch}
          onShowEvidence={onShowEvidence}
          onShowVersion={onShowVersion}
          onShowVersions={onShowVersions}
        />

        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Author</h2>
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
              <NoteField label="Where did you find the name? (optional)" value={note} onChange={setNote} />
            </div>
          )}
          {kind === 'unknown' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">For a text whose author you could not find in it or in its versions.</p>
              <NoteField label="What did you check? (optional)" value={note} onChange={setNote} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2.5 border-t border-gray-200 px-5 py-3">
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
            {save.isPending ? 'Saving…' : 'Submit'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The names the AI found, styled as the Deduplicator's AI analysis is. */
function ModelPrediction({
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
        <Sparkles className="h-4 w-4 text-sky-700" />
        <h2 className="text-sm font-semibold text-sky-900">Model prediction</h2>
        <span className="rounded-full border border-sky-200 bg-white px-2 text-xs font-medium text-sky-800">AI</span>
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
          <p className="mt-1 text-xs text-gray-500">AI can be wrong. Please check.</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-gray-600">
          The AI found no author. Look for a name at the end of the text, or{' '}
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
  const { name, confidence, found } = candidate;
  const evidence = found.find((f) => f.evidence)?.evidence;
  return (
    <li className="py-2 first:pt-1">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-monlam text-xl leading-loose text-gray-900">{name}</span>
        {confidence != null && <span className="shrink-0 text-sm leading-10 tabular-nums text-gray-700">{Math.round(confidence * 100)}% sure</span>}
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

function NoteField({ label, value, onChange }: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} />
    </label>
  );
}
