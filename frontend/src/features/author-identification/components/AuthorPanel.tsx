import { useState } from 'react';
import { ArrowRight, Check, Plus, ScrollText, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CONFIDENCE, SKIP_REASONS, type SkipReason } from '../guidelines';
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

const savedConfidence = (saved: SavedAnswer | null) => (saved && saved.kind !== 'skipped' && saved.confidence > 0 ? saved.confidence : null);

export default function AuthorPanel({
  taskId,
  editionId,
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
  /** BDRC's id of the text, kept with the answer. */
  editionId: string;
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
  const [confidence, setConfidence] = useState<number | null>(savedConfidence(saved));
  const [note, setNote] = useState(saved?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(Boolean(saved?.note));

  const chooseKind = (next: AnswerKind) => {
    onKindChange(next);
    // What was searched is most likely the author's name; it can still be changed.
    if (next === 'not_in_bdrc' && !name) setName(cleanName(query));
  };
  // Picking the chosen person again takes them back.
  const pick = (p: BdrcPerson) => setPerson((current) => (current?.id === p.id ? null : p));
  const closeNote = () => {
    setNote('');
    setNoteOpen(false);
  };

  const draft = (): AuthorAnswer | null => {
    const noted = { note: note.trim() };
    if (kind === 'skipped') return reason ? { kind, reason, ...noted } : null;
    if (confidence == null) return null;
    if (kind === 'not_in_bdrc') return cleanName(name) ? { kind, name: cleanName(name), confidence, ...noted } : null;
    return person ? { kind, personId: person.id, name: person.nameBo, confidence, ...noted } : null;
  };
  const answer = draft();
  // What is still missing, said on the button's hover.
  let missing = '';
  if (kind === 'skipped' && !reason) missing = 'Choose a reason';
  else if (kind === 'person' && !person) missing = 'Choose a person';
  else if (kind === 'not_in_bdrc' && !cleanName(name)) missing = 'Write the name';
  else if (kind !== 'skipped' && confidence == null) missing = 'Choose how sure you are';

  const submit = async () => {
    if (!answer) return;
    try {
      await save.mutateAsync({ taskId, editionId, answer });
    } catch (e) {
      toast.error(`Could not save the answer: ${e instanceof Error ? e.message : 'try again'}`, { position: 'top-center' });
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
    const sure = savedConfidence(saved);
    return (
      <section aria-label="Author" className="flex h-full min-h-0 flex-col bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700">
            <Check className="h-4 w-4" /> Answer saved
          </div>
          <div>
            <div className="break-words font-monlam text-lg leading-loose text-gray-900">{answerLabel(saved)}</div>
            {sure && <p className="mt-1 text-sm text-gray-600">Confidence: {sure} of 5</p>}
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
              onSelect={pick}
            />
          )}
          {kind === 'not_in_bdrc' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                For an author who is not in BDRC. Try other spellings in the search first. In the note, add anything that could help: dates, teacher, monastery, other names.
              </p>
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

      <div className="space-y-3 border-t border-gray-200 px-5 py-3">
        {kind !== 'skipped' && <ConfidencePicker value={confidence} onChange={setConfidence} />}
        {noteOpen ? (
          <div className="text-sm">
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="author-note" className="font-medium text-gray-700">
                Note <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <button
                type="button"
                onClick={closeNote}
                aria-label="Remove the note"
                title="Remove the note"
                className="cursor-pointer rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Textarea
              id="author-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Only about the author: other possible authors, “Duplicate of this author: P…”, dates…"
              className={FIELD}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setNoteOpen(true)} className={`inline-flex items-center gap-1 text-sm ${LINK}`}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add a note
          </button>
        )}
        <div className="flex gap-2">
          {saved && (
            <Button variant="outline" className="h-11 cursor-pointer bg-white" onClick={() => onEditingChange(false)}>
              Cancel
            </Button>
          )}
          <Button
            className="h-11 flex-1 cursor-pointer bg-green-600 text-base text-white hover:bg-green-700"
            disabled={!answer || save.isPending}
            title={missing || undefined}
            onClick={submit}
          >
            {save.isPending ? 'Saving…' : kind === 'skipped' ? 'Skip this text' : 'Submit'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** How sure the annotator is, 1 to 5 (BDRC's scale); required with an author. */
function ConfidencePicker({ value, onChange }: Readonly<{ value: number | null; onChange: (value: number) => void }>) {
  const hint = CONFIDENCE.find((c) => c.value === value)?.hint;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span id="confidence-label" className="font-medium text-gray-700">
          How sure are you?
        </span>
        <span className="text-xs text-gray-500">{value == null ? '1 = only clues · 5 = name clearly written' : hint || `${value} of 5`}</span>
      </div>
      <div role="radiogroup" aria-labelledby="confidence-label" className="grid grid-cols-5 gap-1">
        {CONFIDENCE.map((c) => {
          const on = value === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={c.hint || undefined}
              onClick={() => onChange(c.value)}
              className={`h-9 cursor-pointer rounded-md border text-sm font-semibold tabular-nums transition-colors ${
                on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50'
              }`}
            >
              {c.value}
            </button>
          );
        })}
      </div>
    </div>
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
    <div className="rounded-lg border border-gray-200 bg-white shadow-xs">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <ScrollText className="h-4 w-4 text-gray-500" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">Names found in the texts</h2>
        {candidates.length > 1 && (
          <span className="ml-auto rounded-full bg-amber-100 px-2 text-xs font-medium leading-5 text-amber-900">{candidates.length} different names</span>
        )}
      </div>
      {candidates.length > 0 ? (
        <>
          <ul className="divide-y divide-gray-100 px-4">
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
          <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">A name found is not always the author. Please check.</p>
        </>
      ) : (
        <p className="px-4 py-3 text-sm text-gray-600">
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

const CHIP = 'cursor-pointer rounded-md border px-2 text-xs font-medium leading-6 transition-colors';
const IN_TEXT = `${CHIP} border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400`;
const IN_VERSION = `${CHIP} border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700`;

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
  const inText = found.find((f) => f.versionId == null);
  const inVersions = found.flatMap((f) => {
    const index = f.versionId == null ? -1 : versions.findIndex((v) => v.id === f.versionId);
    return index < 0 ? [] : [{ id: versions[index].id, number: index + 1 }];
  });
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-monlam text-xl leading-loose text-gray-900">{name}</span>
        {!searched && (
          <Button variant="outline" size="sm" className="mt-1 h-7 shrink-0 cursor-pointer bg-white" aria-label={`Search ${name}`} onClick={onSearch}>
            <Search /> Search
          </Button>
        )}
      </div>
      {evidence && (
        <p className="break-words text-sm">
          <mark className="rounded bg-amber-200 px-0.5 font-monlam leading-loose text-gray-900">{evidence}</mark>
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {inText && (
          <button type="button" className={IN_TEXT} title="Show it in the text" onClick={() => onShowEvidence(inText.evidence ?? '')}>
            In the text
          </button>
        )}
        {inVersions.length > 0 && <span className="text-xs text-gray-500">{inText ? 'and written in' : 'Written in'}</span>}
        {inVersions.map((v) => (
          <button key={v.id} type="button" className={IN_VERSION} title="Open this version" onClick={() => onShowVersion(v.id)}>
            Version {v.number}
          </button>
        ))}
        {!inText && inVersions.length > 0 && <span className="text-xs text-gray-500">(not in the text itself)</span>}
      </div>
    </li>
  );
}
