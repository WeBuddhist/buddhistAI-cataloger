import { useState } from 'react';
import { ArrowRight, Check, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSaveAnswer } from '../hooks';
import type { AuthorAnswer, AuthorPrediction, BdrcPerson, SavedAnswer } from '../types';
import { answerLabel, cleanName } from '../utils';
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
    ? { id: saved.personId, nameBo: saved.name, nameWylie: '', matchedName: null, dates: null }
    : null;

export default function AuthorPanel({
  taskId,
  prediction,
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
  onShowVersions,
  onSaved,
  onNext,
}: Readonly<{
  taskId: string;
  prediction: AuthorPrediction | null;
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
  onShowEvidence: () => void;
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
          prediction={prediction}
          searched={kind === 'person' ? searched : ''}
          onSearch={onSearch}
          onShowEvidence={onShowEvidence}
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
                <Input value={name} onChange={(e) => setName(e.target.value)} lang="bo" className="h-11 bg-white font-monlam text-base md:text-base" />
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

/** The AI's guess, styled as the Deduplicator's AI analysis is. */
function ModelPrediction({
  prediction,
  searched,
  onSearch,
  onShowEvidence,
  onShowVersions,
}: Readonly<{
  prediction: AuthorPrediction | null;
  searched: string;
  onSearch: (name: string) => void;
  onShowEvidence: () => void;
  onShowVersions: () => void;
}>) {
  const percent = prediction?.confidence == null ? null : Math.round(prediction.confidence * 100);

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/60 px-4 py-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-sky-700" />
        <h2 className="text-sm font-semibold text-sky-900">Model prediction</h2>
        <span className="rounded-full border border-sky-200 bg-white px-2 text-xs font-medium text-sky-800">AI</span>
        {percent != null && <span className="ml-auto text-sm tabular-nums text-gray-700">{percent}% sure</span>}
      </div>
      {prediction ? (
        <>
          <div className="mt-1 break-words font-monlam text-xl leading-loose text-gray-900">{prediction.name}</div>
          {prediction.evidence && (
            <p className="text-sm text-gray-600">
              Found in the text: <mark className="rounded bg-amber-200 px-0.5 font-monlam text-gray-900">{prediction.evidence}</mark>{' '}
              <button type="button" onClick={onShowEvidence} className={`whitespace-nowrap ${LINK}`}>
                Show in text
              </button>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">AI can be wrong. Please check.</span>
            {searched !== cleanName(prediction.name) && (
              <Button variant="outline" size="sm" className="cursor-pointer bg-white" onClick={() => onSearch(prediction.name)}>
                <Search /> Search this name
              </Button>
            )}
          </div>
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

function NoteField({ label, value, onChange }: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className="bg-white" />
    </label>
  );
}
