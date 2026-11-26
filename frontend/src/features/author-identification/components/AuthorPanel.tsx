import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Plus, ScrollText, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CONFIDENCE, confidenceHint, PERSON_ROLES, roleLabel, skipLabel, SKIP_REASONS, type PersonRole, type SkipReason } from '../guidelines';
import { usePersonSearch, useSaveAnswer } from '../hooks';
import type { AuthorAnswer, BdrcPerson, NameCandidate, SavedAnswer, TextVersion } from '../types';
import { answerLabel, cleanName, FIELD, sameName } from '../utils';
import PersonSearch from './PersonSearch';
import { useT } from '../i18n';

export type AnswerKind = AuthorAnswer['kind'];

/**
 * Where the annotator is. Step 1 is the search in BDRC ('person'). Only from there, once
 * they can't find the author, comes step 2: 'other' until "not in BDRC" or "skip" is chosen.
 */
export type PanelStep = AnswerKind | 'other';

const OTHER_KINDS = [
  { kind: 'not_in_bdrc', label: 'answer.notInBdrc', hint: 'panel.notInBdrcHint' },
  { kind: 'skipped', label: 'panel.skipText', hint: 'panel.skipHint' },
] as const;

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
  kind: PanelStep;
  onKindChange: (kind: PanelStep) => void;
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
  const t = useT();
  const save = useSaveAnswer();
  const [person, setPerson] = useState<BdrcPerson | null>(savedPerson(saved));
  const [name, setName] = useState(saved?.kind === 'not_in_bdrc' ? saved.name : '');
  const [reason, setReason] = useState<SkipReason | null>(saved?.kind === 'skipped' ? saved.reason : null);
  const [confidence, setConfidence] = useState<number | null>(savedConfidence(saved));
  const [role, setRole] = useState<PersonRole>(saved && saved.kind !== 'skipped' ? saved.role : 'author');
  // With "Other": which role, in the annotator's words.
  const [roleOther, setRoleOther] = useState(saved && saved.kind !== 'skipped' ? (saved.roleOther ?? '') : '');
  const [note, setNote] = useState(saved?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(Boolean(saved?.note));

  const chooseKind = (next: PanelStep) => {
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
    if (kind === 'other') return null;
    if (kind === 'skipped') return reason ? { kind, reason, ...noted } : null;
    const roled = role === 'other' ? { role, roleOther: roleOther.trim() } : { role };
    if (confidence == null || (role === 'other' && !roled.roleOther)) return null;
    if (kind === 'not_in_bdrc') return cleanName(name) ? { kind, name: cleanName(name), ...roled, confidence, ...noted } : null;
    return person ? { kind, personId: person.id, name: person.nameBo, ...roled, confidence, ...noted } : null;
  };
  const answer = draft();
  // How sure they are is asked once there is an author to be sure of.
  const asksConfidence = kind === 'not_in_bdrc' || (kind === 'person' && person != null);
  // Step 2 only once they have looked: after a search, or when there is no name to search.
  const canLeaveSearch = searched !== '' || candidates.length === 0;
  // The same search as the results below (shared cache): nobody found, or how many.
  const results = usePersonSearch(searched);
  const total = results.data?.pages[0]?.total ?? 0;
  const nobody = results.isSuccess && total === 0;
  // What is still missing, said on the button's hover.
  let missing = '';
  if (kind === 'skipped' && !reason) missing = t('panel.missingReason');
  else if (kind === 'person' && !person) missing = t('panel.missingPerson');
  else if (kind === 'not_in_bdrc' && !cleanName(name)) missing = t('panel.missingName');
  else if (kind !== 'skipped' && confidence == null) missing = t('panel.missingConfidence');
  else if (kind !== 'skipped' && role === 'other' && !roleOther.trim()) missing = t('panel.missingRoleOther');

  const submit = async () => {
    if (!answer) return;
    try {
      await save.mutateAsync({ taskId, editionId, answer });
    } catch (e) {
      toast.error(t('panel.saveFailed', { error: e instanceof Error ? e.message : t('panel.tryAgain') }), { position: 'top-center' });
      return;
    }
    if (saved) {
      onEditingChange(false);
      toast.success(t('panel.changed'), { position: 'top-center' });
    } else {
      onSaved();
    }
  };

  if (saved && !editing) {
    const sure = savedConfidence(saved);
    return (
      <section aria-label={t('panel.author')} className="flex h-full min-h-0 flex-col bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700">
            <Check className="h-4 w-4" /> {t('panel.saved')}
          </div>
          <div>
            <div className="break-words font-monlam text-lg leading-loose text-gray-900">{answerLabel(saved)}</div>
            {saved.kind !== 'skipped' && <p className="mt-1 text-sm text-gray-600">{t('panel.roleOf', { role: saved.role === 'other' && saved.roleOther ? saved.roleOther : roleLabel(saved.role) })}</p>}
            {sure && <p className="mt-1 text-sm text-gray-600">{t('panel.confidenceOf', { n: sure })}</p>}
            {saved.note && (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-600">
                <span className="font-medium text-gray-700">{t('panel.noteLabel')}</span> {saved.note}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 border-t border-gray-200 px-4 py-2.5">
          <Button variant="outline" className="h-10 flex-1 cursor-pointer bg-white" onClick={() => onEditingChange(true)}>
            {t('panel.changeAnswer')}
          </Button>
          {onNext && (
            <Button variant="outline" className="h-10 flex-1 cursor-pointer bg-white" onClick={onNext}>
              {t('panel.nextText')} <ArrowRight />
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t('panel.author')} className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <NamesFound
          candidates={candidates}
          versions={versions}
          searched={kind === 'person' ? searched : ''}
          onSearch={onSearch}
          onShowEvidence={onShowEvidence}
          onShowVersion={onShowVersion}
          onShowVersions={onShowVersions}
        />

        {kind === 'person' ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">{t('panel.findInBdrc')}</h2>
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
            {/* Nobody found: step 2 is the next thing to do, right here. */}
            {nobody && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">{t('panel.stillNotFound')}</h3>
                <OtherChoices onChoose={chooseKind} />
              </div>
            )}
          </div>
        ) : (
          <OtherStep
            kind={kind}
            onKindChange={chooseKind}
            name={name}
            onNameChange={setName}
            reason={reason}
            onReasonChange={setReason}
          />
        )}
      </div>

      {/* The way to step 2: kept in sight under the results, however many there are, and set
          apart from them. Not once a person is picked. */}
      {kind === 'person' && canLeaveSearch && !person && !nobody && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-gray-200 bg-gray-50 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">{t(total > 0 ? 'panel.noneOfThese' : 'panel.cantFind')}</p>
            <p className="text-xs text-gray-500">{t('panel.cantFindHelp')}</p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 cursor-pointer bg-white" onClick={() => chooseKind('other')}>
            {t('panel.otherAnswers')} <ArrowRight aria-hidden />
          </Button>
        </div>
      )}

      {kind !== 'other' && (
        <div className="space-y-2.5 border-t border-gray-200 px-4 py-2.5">
          {/* Two rows of choices, their labels in one column so they read as one small form. */}
          {asksConfidence && (
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <RolePicker value={role} onChange={setRole} other={roleOther} onOtherChange={setRoleOther} />
              <ConfidencePicker value={confidence} onChange={setConfidence} />
            </div>
          )}
          {noteOpen ? (
            <div className="text-sm">
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="author-note" className="font-medium text-gray-700">
                  {t('panel.note')} <span className="font-normal text-gray-500">{t('panel.optional')}</span>
                </label>
                <button
                  type="button"
                  onClick={closeNote}
                  aria-label={t('panel.removeNote')}
                  title={t('panel.removeNote')}
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
                placeholder={t('panel.notePlaceholder')}
                className={FIELD}
              />
            </div>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className={`inline-flex items-center gap-1 text-sm ${LINK}`}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> {t('panel.addNote')}
            </button>
          )}
          <div className="flex gap-2">
            {saved && (
              <Button variant="outline" className="h-10 cursor-pointer bg-white" onClick={() => onEditingChange(false)}>
                {t('panel.cancel')}
              </Button>
            )}
            <Button
              className="h-10 flex-1 cursor-pointer bg-green-600 text-white hover:bg-green-700"
              disabled={!answer || save.isPending}
              title={missing || undefined}
              onClick={submit}
            >
              {save.isPending ? t('panel.saving') : t(kind === 'skipped' ? 'panel.skipText' : 'panel.submit')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Step 2, when the author can't be found in BDRC: not in BDRC, or skip the text. */
function OtherStep({
  kind,
  onKindChange,
  name,
  onNameChange,
  reason,
  onReasonChange,
}: Readonly<{
  kind: Exclude<PanelStep, 'person'>;
  onKindChange: (kind: PanelStep) => void;
  name: string;
  onNameChange: (name: string) => void;
  reason: SkipReason | null;
  onReasonChange: (reason: SkipReason) => void;
}>) {
  const t = useT();
  const chosen = OTHER_KINDS.find((k) => k.kind === kind);
  const toSkip = kind === 'not_in_bdrc';
  return (
    <div>
      <button type="button" onClick={() => onKindChange('person')} className={`mb-2 inline-flex items-center gap-1 text-sm ${LINK}`}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('panel.backToSearch')}
      </button>
      <h2 className="mb-2 text-sm font-semibold text-gray-900">{t('panel.otherTitle')}</h2>

      {/* First the choice; once made, only that answer, with what it needs right under it. */}
      {chosen ? (
        <>
          <div className="overflow-hidden rounded-lg border border-blue-600">
            <div className="bg-blue-50 px-3 py-2 text-sm">
              <span className="block font-medium text-gray-900">{t(chosen.label)}</span>
              <span className="block text-xs text-gray-600">{t(chosen.hint)}</span>
            </div>
            <div className="border-t border-blue-100 bg-white px-3 py-3">
              {chosen.kind === 'not_in_bdrc' ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">{t('panel.notInBdrcHelp')}</p>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">{t('panel.nameInTibetan')}</span>
                    <Input value={name} onChange={(e) => onNameChange(e.target.value)} lang="bo" className={`h-10 font-monlam text-base md:text-base ${FIELD}`} />
                  </label>
                </div>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm text-gray-600">{t('panel.whySkip')}</legend>
                  {SKIP_REASONS.map((r) => (
                    <label
                      key={r.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                        reason === r.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="skip-reason"
                        checked={reason === r.id}
                        onChange={() => onReasonChange(r.id)}
                        className="h-4 w-4 shrink-0 accent-blue-600"
                      />
                      {skipLabel(r.id)}
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          </div>
          {/* The other answer, said in plain words, instead of a bare "Change". */}
          <p className="mt-3 text-sm text-gray-600">
            {t(toSkip ? 'panel.switchToSkipQuestion' : 'panel.switchToNotInBdrcQuestion')}{' '}
            <button type="button" onClick={() => onKindChange(toSkip ? 'skipped' : 'not_in_bdrc')} className={LINK}>
              {t(toSkip ? 'panel.switchToSkip' : 'panel.switchToNotInBdrc')}
            </button>
          </p>
        </>
      ) : (
        <OtherChoices onChoose={onKindChange} />
      )}
    </div>
  );
}

/** The two answers when the author isn't found: each a plain button with what it means. */
function OtherChoices({ onChoose }: Readonly<{ onChoose: (kind: PanelStep) => void }>) {
  const t = useT();
  return (
    <div className="space-y-2">
      {OTHER_KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          onClick={() => onChoose(k.kind)}
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm hover:border-blue-400 hover:bg-blue-50/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-gray-900">{t(k.label)}</span>
            <span className="block text-xs text-gray-500">{t(k.hint)}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        </button>
      ))}
    </div>
  );
}

const SEGMENT = 'cursor-pointer border-l border-gray-300 text-xs font-semibold transition-colors first:border-l-0';
const segment = (on: boolean) => `${SEGMENT} ${on ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-700'}`;

/**
 * The role the person had in the text, all four always in sight; Author is chosen at first.
 * What a role means is on its button's hover, and said under the row once it isn't the
 * author's. "Other" asks which role, in a box of its own. Cells of the panel's two-column grid.
 */
function RolePicker({
  value,
  onChange,
  other,
  onOtherChange,
}: Readonly<{ value: PersonRole; onChange: (role: PersonRole) => void; other: string; onOtherChange: (other: string) => void }>) {
  const t = useT();
  return (
    <>
      <span id="role-label" className="text-sm font-medium text-gray-700">
        {t('panel.role')}
      </span>
      <div role="radiogroup" aria-labelledby="role-label" className="inline-flex w-fit flex-wrap overflow-hidden rounded-md border border-gray-300">
        {PERSON_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            title={r === 'other' ? undefined : t(`roleHint.${r}`)}
            onClick={() => onChange(r)}
            className={`h-7 px-2.5 ${segment(value === r)}`}
          >
            {roleLabel(r)}
          </button>
        ))}
      </div>
      {/* A row of the form like the others: its label in the label column, the box full width. */}
      {value === 'other' && (
        <>
          <label htmlFor="role-other" className="text-sm font-medium text-gray-700">
            {t('panel.whichRole')}
          </label>
          <Input
            id="role-other"
            value={other}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder={t('panel.whichRolePlaceholder')}
            autoFocus
            className={`h-8 w-full ${FIELD}`}
          />
        </>
      )}
      {value !== 'other' && value !== 'author' && <p className="col-start-2 -mt-1 text-xs text-gray-500">{t(`roleHint.${value}`)}</p>}
    </>
  );
}

/** How sure the annotator is, 1 to 5 (BDRC's scale); required with an author. Cells of the panel's grid. */
function ConfidencePicker({ value, onChange }: Readonly<{ value: number | null; onChange: (value: number) => void }>) {
  const t = useT();
  const hint = value == null ? '' : confidenceHint(value);
  return (
    <>
      <span id="confidence-label" className="text-sm font-medium text-gray-700">
        {t('panel.howSure')}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div role="radiogroup" aria-labelledby="confidence-label" className="inline-flex overflow-hidden rounded-md border border-gray-300">
          {CONFIDENCE.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={value === level}
              title={confidenceHint(level) || undefined}
              onClick={() => onChange(level)}
              className={`h-7 w-8 tabular-nums ${segment(value === level)}`}
            >
              {level}
            </button>
          ))}
        </div>
        <span className="min-w-0 text-xs text-gray-500">{value == null ? t('panel.scaleHint') : hint || t('panel.levelOf', { n: value })}</span>
      </div>
    </>
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
  const t = useT();
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-xs">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <ScrollText className="h-4 w-4 text-gray-500" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">{t('names.title')}</h2>
        {candidates.length > 1 && (
          <span className="ml-auto rounded-full bg-amber-100 px-2 text-xs font-medium leading-5 text-amber-900">{t('names.different', { count: candidates.length })}</span>
        )}
      </div>
      {candidates.length > 0 ? (
        <>
          <ul className="divide-y divide-gray-100 px-3">
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
          <p className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">{t('names.caution')}</p>
        </>
      ) : (
        <p className="px-3 py-2.5 text-sm text-gray-600">
          {t('names.none')}{' '}
          <button type="button" onClick={onShowVersions} className={LINK}>
            {t('names.checkVersions')}
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
  const t = useT();
  const { name, found } = candidate;
  // A quote around the name; not the name itself again.
  const evidence = found.find((f) => f.evidence && !sameName(f.evidence, name))?.evidence;
  const inText = found.find((f) => f.versionId == null);
  const inVersions = found.flatMap((f) => {
    const index = f.versionId == null ? -1 : versions.findIndex((v) => v.id === f.versionId);
    return index < 0 ? [] : [{ id: versions[index].id, number: index + 1 }];
  });
  return (
    <li className="py-2">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-monlam text-lg leading-loose text-gray-900">{name}</span>
        {!searched && (
          <Button variant="outline" size="sm" className="mt-1 h-7 shrink-0 cursor-pointer bg-white text-xs" aria-label={t('names.searchName', { name })} onClick={onSearch}>
            <Search /> {t('names.search')}
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
          <button type="button" className={IN_TEXT} title={t('names.showInText')} onClick={() => onShowEvidence(inText.evidence ?? '')}>
            {t('names.inText')}
          </button>
        )}
        {inVersions.length > 0 && <span className="text-xs text-gray-500">{t(inText ? 'names.andWrittenIn' : 'names.writtenIn')}</span>}
        {inVersions.map((v) => (
          <button key={v.id} type="button" className={IN_VERSION} title={t('names.openVersion')} onClick={() => onShowVersion(v.id)}>
            {t('names.version', { n: v.number })}
          </button>
        ))}
        {!inText && inVersions.length > 0 && <span className="text-xs text-gray-500">{t('names.notInText')}</span>}
      </div>
    </li>
  );
}
