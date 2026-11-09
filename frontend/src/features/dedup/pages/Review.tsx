import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Flag, Lock, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { saveVoiceNote, type AdjudicationItem, type AdminPair, type DecisionInput, type MyItemsState, type ReviewItem } from '../api/review';
import AnswerHistory from '../components/AnswerHistory';
import AnnotatorAnswers from '../components/AnnotatorAnswers';
import CantAnswerDialog, { type CantAnswerStart } from '../components/CantAnswerDialog';
import FullTextDialog, { type FullTextView } from '../components/FullTextDialog';
import PairNotes from '../components/PairNotes';
import PreferredCopyDialog, { type PreferredChoice } from '../components/PreferredCopyDialog';
import CopyPairLink from '../components/CopyPairLink';
import PairEvidence from '../components/PairEvidence';
import type { ScanTag } from '../components/ScanPanel';
import { useActiveTimer } from '../hooks/useActiveTimer';
import {
  useAdminPair,
  useAdjudicationItem,
  useAdjudicationQueue,
  useBatchName,
  useCorrectPair,
  useItem,
  useMyItems,
  useSaveAdjudication,
  useSaveDecision,
} from '../hooks/useReview';
import { editedNote, makeNote, notesOf, usePairDraft, withNotes, type NewNote, type NoteEdit, type PairNote, type VoiceRecording } from '../notes';
import { formatNumber, isDecided, issueLabel, verdictLabel } from '../utils';

const CONFIDENCE = [1, 2, 3, 4, 5];
// The shared Button has no pointer cursor; added here to leave other features untouched.
const PTR = 'cursor-pointer';
const CHOSEN_NEUTRAL = 'border-gray-800 bg-gray-800 text-white hover:bg-gray-900 hover:text-white';

export type ReviewMode = 'annotate' | 'adjudicate' | 'correct';

// The admin pair as the answer screen reads an item: its final answer in the usual fields.
function correctionItem(p: AdminPair): ReviewItem {
  const f = p.final;
  return {
    item_id: p.item_id,
    batch_id: p.batch_id,
    kind: p.kind,
    subject: p.subject,
    evidence: p.evidence,
    status: f ? 'finalized' : 'new',
    verdict: f?.verdict ?? null,
    abstention_reason: f?.abstention_reason ?? null,
    confidence: f?.confidence ?? null,
    issues: f?.issues ?? null,
    partner_payload: f?.partner_payload ?? null,
    annotator_id: f?.user_id ?? null,
    decided_at: f?.decided_at ?? null,
    sync_state: f?.sync_state ?? null,
    assignment: null,
    review_mode: p.review_mode,
    locked: false,
    corrected: p.corrected,
    answer_changed_at: null,
    answer_changes: 0,
  };
}

// Keys (plan §11): J same, F different, Space can't answer, X flag an issue,
// 1-5 confidence, arrows move.
//
// `adjudicate`: the same screen for a disputed pair, with both annotators' answers above
// the texts and an optional note. The adjudicator's answer is final.
// `correct` (admins, /dedup-admin/pairs/:id): any pair, with every answer saved on it
// above the texts; the admin's answer replaces the final one. Previous / next follow the
// admin pair list the pair was opened from.
export default function Review({ mode = 'annotate' }: Readonly<{ mode?: ReviewMode }>) {
  const { t } = useTranslation();
  const adjudicate = mode === 'adjudicate';
  const correct = mode === 'correct';
  // From the admin pair list: its filters (to go back to) and the pairs on its page.
  // From the annotator's list: the tab it was opened from.
  const fromList = useLocation().state as { from?: string; ids?: number[]; tab?: MyItemsState } | null;
  const tab = fromList?.tab;
  const { itemId: itemIdParam } = useParams();
  const itemId = Number(itemIdParam);
  const navigate = useNavigate();
  const batchName = useBatchName();

  const annotatorItem = useItem(mode === 'annotate' ? itemId : undefined);
  const adjudicationItem = useAdjudicationItem(adjudicate ? itemId : undefined);
  const adminPair = useAdminPair(correct ? itemId : undefined);
  const adminItem = useMemo(() => (adminPair.data ? correctionItem(adminPair.data) : undefined), [adminPair.data]);
  const itemQuery: { data?: ReviewItem; error: Error | null; isLoading: boolean; isPlaceholderData: boolean } = correct
    ? { data: adminItem, error: adminPair.error, isLoading: adminPair.isLoading, isPlaceholderData: false }
    : adjudicate
      ? adjudicationItem
      : annotatorItem;
  const myList = useMyItems('all', undefined, mode === 'annotate');
  // Previous / next stay in the tab the pair was opened from (a link or a refresh has none:
  // the whole list). A pair not in that tab, e.g. one just answered from "To do" with no
  // more left, falls back to the whole list too.
  const myTabList = useMyItems(tab ?? 'all', undefined, mode === 'annotate' && tab != null);
  const inTab = Boolean(tab && myTabList.data?.some((i) => i.item_id === itemId));
  const adjudicationList = useAdjudicationQueue('all', adjudicate);
  const adminList = useMemo(() => ({ data: (fromList?.ids ?? []).map((id) => ({ item_id: id }) as ReviewItem) }), [fromList?.ids]);
  const list: { data?: ReviewItem[] } = correct ? adminList : adjudicate ? adjudicationList : inTab ? myTabList : myList;
  const loaded = useMemo(() => list.data ?? [], [list.data]);
  const total = loaded.length;
  const index = loaded.findIndex((i) => i.item_id === itemId);

  const prevId = index > 0 ? loaded[index - 1].item_id : null;
  const nextId = index >= 0 && index < loaded.length - 1 ? loaded[index + 1].item_id : null;
  const goTo = useCallback(
    (id: number | null) => {
      if (id == null) return;
      if (correct) navigate(`/dedup-admin/pairs/${id}`, { state: fromList });
      else if (adjudicate) navigate(`/dedup/adjudicate/${id}`);
      else navigate(`/dedup/item/${id}`, { state: tab ? { tab } : null });
    },
    [navigate, adjudicate, correct, fromList, tab],
  );

  const item = itemQuery.data as ReviewItem | AdjudicationItem | undefined;
  const adjItem = adjudicate ? (item as AdjudicationItem | undefined) : undefined;
  const saveAnswer = useSaveDecision();
  const saveAdjudication = useSaveAdjudication();
  const saveCorrection = useCorrectPair();
  const save = correct ? saveCorrection : adjudicate ? saveAdjudication : saveAnswer;
  // Both annotators have answered (or an admin corrected the pair): the answer is shown
  // but can no longer change. An adjudicator's pair is only ever locked by a correction;
  // an admin can always correct again.
  const locked = Boolean(!correct && item?.locked);
  const lockedByAdmin = Boolean(item?.corrected);
  // Only for the person doing the work on the pair (an admin viewing it is not).
  const { commit: commitActiveTime } = useActiveTimer(
    item?.item_id,
    Boolean(!correct && item && loaded.some((i) => i.item_id === item.item_id)),
    Boolean(item && isDecided(item)),
  );
  const [note, setNote] = useState('');
  useEffect(() => {
    setNote(adjItem?.note ?? '');
  }, [adjItem?.item_id, adjItem?.note]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const draft = usePairDraft(item?.item_id);
  const savedNotes = useMemo(() => notesOf(item?.partner_payload), [item?.partner_payload]);
  const notes = useMemo(() => [...savedNotes, ...draft.notes], [savedNotes, draft.notes]);
  const [dialog, setDialog] = useState<CantAnswerStart | null>(null);
  const [fullText, setFullText] = useState<FullTextView | null>(null);
  // Stays open from pair to pair, so the scans can be read alongside each one.
  const [scan, setScan] = useState<ScanTag | null>(null);
  const [askPreferred, setAskPreferred] = useState(false);
  const advanceTimer = useRef<number | undefined>(undefined);
  // The docked action bar wraps onto several rows on a phone; the page keeps its
  // height free so nothing is hidden behind it.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  const hasItem = itemQuery.data != null;
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasItem]);

  useEffect(() => {
    setConfidence(item?.confidence ?? null);
  }, [item?.item_id, item?.confidence]);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  const submit = useCallback(
    async (fields: DecisionInput) => {
      if (!item) return;
      const body: DecisionInput = {
        // What was flagged while the pair had no answer goes with the answer.
        ...(fields.verdict && draft.issues.length > 0 ? { issues: draft.issues } : {}),
        ...fields,
        // Only "same" carries a preferred copy, so a stale one is dropped; notes stay.
        ...(fields.verdict ? { partner_payload: withNotes(fields.partner_payload, notes) } : {}),
        // Confidence only means something alongside a verdict.
        ...(fields.verdict && confidence != null ? { confidence } : {}),
      };
      commitActiveTime();
      try {
        if (correct) {
          // A correction stays on the pair, so the admin sees it land in the history.
          await saveCorrection.mutateAsync({ itemId: item.item_id, fields: body });
          toast.success(t('dedup.admin.pair.saved'));
          return;
        }
        if (adjudicate) await saveAdjudication.mutateAsync({ itemId: item.item_id, fields: { ...body, note: note.trim() || null } });
        else await saveAnswer.mutateAsync({ itemId: item.item_id, fields: body });
        if (fields.verdict) draft.clear();
        // Reporting a problem on an answered pair stays here; answering moves on.
        if (fields.verdict) advanceTimer.current = window.setTimeout(() => goTo(nextId), 250);
      } catch (e) {
        toast.error(t('dedup.review.saveFailed', { error: (e as Error).message }));
        throw e;
      }
    },
    [item, confidence, correct, adjudicate, note, notes, draft, saveCorrection, saveAdjudication, saveAnswer, goTo, nextId, commitActiveTime, t],
  );

  // Notes on a saved answer go onto that same answer; without one they wait for it.
  const saveNotes = useCallback(
    (next: PairNote[]) => {
      if (!item?.verdict) return;
      const fields: DecisionInput = {
        verdict: item.verdict,
        abstention_reason: item.abstention_reason,
        confidence: item.confidence,
        partner_payload: withNotes(item.partner_payload, next),
      };
      const saving = adjudicate
        ? saveAdjudication.mutateAsync({ itemId: item.item_id, fields })
        : saveAnswer.mutateAsync({ itemId: item.item_id, fields });
      saving.catch((e: Error) => toast.error(t('dedup.review.saveFailed', { error: e.message })));
    },
    [item, adjudicate, saveAdjudication, saveAnswer, t],
  );

  /** Stores a spoken note's recording (S3); its id, or undefined if that failed. The
   * note's text is saved either way, only without the audio. */
  const storeRecording = useCallback(
    async (recording: VoiceRecording | undefined) => {
      if (!recording || !item) return undefined;
      try {
        return await saveVoiceNote(item.item_id, recording.audio, recording.stt);
      } catch (e) {
        toast.error(t('dedup.notes.voice.audioNotSaved'), { description: e instanceof Error ? e.message : undefined });
        return undefined;
      }
    },
    [item, t],
  );

  const addNote = useCallback(
    async (added: NewNote) => {
      const recordingId = await storeRecording(added.recording);
      const made = makeNote({ ...added, voice_note_ids: recordingId ? [recordingId] : undefined });
      if (item?.verdict) saveNotes([...savedNotes, made]);
      else draft.addNote(made);
    },
    [item?.verdict, storeRecording, saveNotes, savedNotes, draft],
  );

  const editNote = useCallback(
    async (id: string, edit: NoteEdit) => {
      const recordingId = await storeRecording(edit.recording);
      const saved = savedNotes.find((n) => n.id === id);
      if (saved) {
        saveNotes(savedNotes.map((n) => (n.id === id ? editedNote(n, edit, recordingId) : n)));
        return;
      }
      const drafted = draft.notes.find((n) => n.id === id);
      if (drafted) draft.replaceNote(editedNote(drafted, edit, recordingId));
    },
    [storeRecording, saveNotes, savedNotes, draft],
  );

  const removeNote = useCallback(
    (id: string) => {
      if (savedNotes.some((n) => n.id === id)) saveNotes(savedNotes.filter((n) => n.id !== id));
      else draft.removeNote(id);
    },
    [saveNotes, savedNotes, draft],
  );

  // A note on an answer already saved goes with that same answer.
  const saveNote = useCallback(() => {
    if (!item?.verdict) return;
    saveAdjudication
      .mutateAsync({
        itemId: item.item_id,
        fields: {
          verdict: item.verdict,
          abstention_reason: item.abstention_reason,
          confidence: item.confidence,
          note: note.trim() || null,
        },
      })
      .then(() => toast.success(t('dedup.review.noteSaved')))
      .catch((e: Error) => toast.error(t('dedup.review.saveFailed', { error: e.message })));
  }, [item, note, saveAdjudication, t]);

  const decide = useCallback(
    (verdict: 'same' | 'different') => {
      if (verdict === 'same') {
        setAskPreferred(true);
        return;
      }
      submit({ verdict }).catch(() => {});
    },
    [submit],
  );

  const saveSame = useCallback(
    (preferred: PreferredChoice) => submit({ verdict: 'same', partner_payload: { preferred_mw_id: preferred } }),
    [submit],
  );

  const answered = Boolean(item && isDecided(item));
  const flagIssue = useCallback(() => {
    if (locked) toast.info(t(lockedByAdmin ? 'dedup.review.correctedInfo' : 'dedup.review.lockedInfo'));
    else setDialog('issue');
  }, [locked, lockedByAdmin, t]);

  // An issue sits beside an answer (plan §5): before there is one, it waits for it.
  const saveDialog = useCallback(
    async (fields: DecisionInput) => {
      if (answered || fields.verdict) await submit(fields);
      else draft.setIssues(fields.issues ?? []);
    },
    [answered, submit, draft],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || fullText || askPreferred || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft') goTo(prevId);
      else if (k === 'arrowright') goTo(nextId);
      else if (locked) return;
      else if (k === 'j') decide('same');
      else if (k === 'f') decide('different');
      else if (k === 'x') flagIssue();
      else if (k === ' ') {
        e.preventDefault();
        setDialog('default');
      } else if (k >= '1' && k <= '5') setConfidence(Number(k));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, fullText, askPreferred, decide, flagIssue, goTo, prevId, nextId, locked]);

  // Someone else's pair (e.g. a link copied from the address bar into a spreadsheet):
  // show the read-only page instead of a work page they cannot use.
  const notMine = itemQuery.error != null || (item != null && !itemQuery.isPlaceholderData && item.assignment == null);
  if (mode === 'annotate' && notMine) {
    return <Navigate to={`/dedup/pair/${itemIdParam}`} replace state={{ notMine: true }} />;
  }

  if (itemQuery.isLoading) {
    return <div className="py-24 text-center text-gray-500">{t('dedup.review.loading')}</div>;
  }
  if (itemQuery.error || !item) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t('dedup.review.loadFailed', { id: itemIdParam, error: itemQuery.error?.message ?? t('dedup.review.notFound') })}
        </div>
      </div>
    );
  }

  const ev = item.evidence;
  const cardA = ev.a ?? { mw_id: item.subject.a_mw ?? '' };
  const cardB = ev.b ?? { mw_id: item.subject.b_mw ?? '' };
  const isChosen = (...v: string[]) => item.verdict != null && v.includes(item.verdict);
  const tick = (...v: string[]) => (isChosen(...v) ? <Check className="h-4 w-4" /> : null);
  // The saved "which copy" answer: undefined = never asked, null = no preference.
  const preferred = item.partner_payload?.preferred_mw_id as PreferredChoice | undefined;
  let preferredNote = '';
  if (item.verdict === 'same' && preferred !== undefined) {
    if (preferred === null) preferredNote = ` · ${t('dedup.review.noPreference')}`;
    else preferredNote = ` · ${t(preferred === cardA.mw_id ? 'dedup.review.aBetter' : 'dedup.review.bBetter')}`;
  }
  const recorded = item.verdict ? verdictLabel(item.verdict) + preferredNote : null;
  const issues = draft.issues.length > 0 ? draft.issues : (item.issues ?? []);
  const problems = issues.map((i) => issueLabel(i.kind));
  const canWriteNotes = !correct && !locked;

  return (
    <div className={`w-full ${scan ? 'max-w-none' : 'max-w-7xl'} mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6`} style={{ paddingBottom: barHeight + 24 }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={correct ? `/dedup-admin/pairs${fromList?.from ?? ''}` : adjudicate ? '/dedup/adjudicate' : tab === 'done' ? '/dedup?tab=done' : '/dedup'}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />{' '}
          {correct
            ? t('dedup.admin.pairs.back')
            : t(adjudicate ? 'dedup.adjudicationQueue.title' : 'dedup.review.myItems')}
          {correct && <span className="ml-1 text-xs font-medium tabular-nums text-gray-500">· {t('dedup.pairView.title', { id: item.item_id })}</span>}
          <span className="ml-1 text-xs text-gray-400" title={item.batch_id}>· {batchName(item.batch_id)}</span>
        </Link>
        <div className="flex items-center gap-2">
          <CopyPairLink itemId={item.item_id} />
          {index >= 0 && (
            <span className="mr-1 text-xs tabular-nums text-gray-500">
              {t('dedup.review.position', { n: formatNumber(index + 1), total: formatNumber(total) })}
            </span>
          )}
          <Button variant="outline" size="sm" className={PTR} onClick={() => goTo(prevId)} disabled={prevId == null} aria-label={t('dedup.review.previousItem')}>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t('dedup.review.previous')}</span>
          </Button>
          <Button variant="outline" size="sm" className={PTR} onClick={() => goTo(nextId)} disabled={nextId == null} aria-label={t('dedup.review.nextItem')}>
            <span className="hidden sm:inline">{t('dedup.review.next')}</span> <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <PairEvidence
        itemId={item.item_id}
        evidence={ev}
        cardA={cardA}
        cardB={cardB}
        onFullText={setFullText}
        scan={scan}
        onScanChange={setScan}
        bottomInset={barHeight}
        onAddNote={canWriteNotes ? addNote : undefined}
        afterTexts={<PairNotes notes={notes} onRemove={canWriteNotes ? removeNote : undefined} onEdit={canWriteNotes ? editNote : undefined} pending={!answered} />}
      >
        {adjItem && <AnnotatorAnswers answers={adjItem.annotations} a={cardA} b={cardB} />}
        {correct && adminPair.data && <AnswerHistory history={adminPair.data.history} corrected={adminPair.data.corrected} />}
      </PairEvidence>

      {adjudicate && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <label htmlFor="adjudication-note" className="text-sm font-medium text-gray-700">
            {t('dedup.review.note')} <span className="font-normal text-gray-400">{t('dedup.cantAnswer.optional')}</span>
          </label>
          <Textarea
            id="adjudication-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('dedup.review.notePlaceholder')}
            maxLength={2000}
            className="mt-1.5 min-h-[64px] text-sm"
          />
          {answered && note.trim() !== (adjItem?.note ?? '') && (
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="outline" className={PTR} onClick={saveNote} disabled={save.isPending}>
                {t('dedup.review.saveNote')}
              </Button>
            </div>
          )}
        </div>
      )}

      <div
        ref={barRef}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur"
      >
        {/* Status strip: what is saved for this pair, and its data problems. Shown once there is something to say. */}
        {(answered || problems.length > 0 || save.isPending || locked) && (
          <div className="border-b border-gray-100 bg-gray-50/80">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-xs sm:px-6 lg:px-8">
              {save.isPending ? (
                <span className="text-gray-500">{t('dedup.common.saving')}</span>
              ) : (
                recorded && (
                  <span className="inline-flex items-center gap-1.5 text-gray-600">
                    <Check className="h-3.5 w-3.5 text-green-600" />
                    {t(adjudicate || correct ? 'dedup.review.finalAnswer' : 'dedup.review.saved')} <span className="font-medium text-gray-900">{recorded}</span>
                    {correct && adminPair.data?.final && (
                      <span className="text-gray-500">
                        · {adminPair.data.final.user_name ?? adminPair.data.final.user_id}
                      </span>
                    )}
                  </span>
                )
              )}
              {correct && lockedByAdmin && (
                <span className="inline-flex items-center gap-1 text-blue-700">
                  <ShieldCheck className="h-3.5 w-3.5" /> {t('dedup.admin.pair.correctedBadge')}
                </span>
              )}
              {problems.map((p, i) => (
                <span
                  key={`${p}-${i}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-800"
                >
                  <Flag className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p}</span>
                </span>
              ))}
              {!answered && problems.length > 0 && <span className="text-amber-800">{t('dedup.review.needsAnswer')}</span>}
              {locked && (
                <span className="inline-flex items-center gap-1.5 text-gray-600">
                  <Lock className="h-3.5 w-3.5" />{' '}
                  {lockedByAdmin ? t('dedup.review.correctedLocked') : 'Both annotators have answered, so this answer is locked'}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button
              variant="outline"
              className={`${PTR} ${
                isChosen('same')
                  ? 'border-green-600 bg-green-600 text-white hover:bg-green-700 hover:text-white'
                  : 'border-green-300 text-green-700 hover:bg-green-50'
              }`}
              onClick={() => decide('same')}
              disabled={save.isPending || locked}
              aria-pressed={isChosen('same')}
            >
              {tick('same')} {t('dedup.verdict.same')} <Kbd>J</Kbd>
            </Button>
            <Button
              variant="outline"
              className={`${PTR} ${
                isChosen('different')
                  ? 'border-red-600 bg-red-600 text-white hover:bg-red-700 hover:text-white'
                  : 'border-red-300 text-red-700 hover:bg-red-50'
              }`}
              onClick={() => decide('different')}
              disabled={save.isPending || locked}
              aria-pressed={isChosen('different')}
            >
              {tick('different')} {t('dedup.verdict.different')} <Kbd>F</Kbd>
            </Button>
            <Button
              variant="outline"
              className={`${PTR} ${isChosen('not_sure') ? CHOSEN_NEUTRAL : ''}`}
              onClick={() => setDialog('default')}
              disabled={save.isPending || locked}
              aria-pressed={isChosen('not_sure')}
            >
              {tick('not_sure')} {t('dedup.answer.cantAnswer')} <Kbd>{t('dedup.review.spaceKey')}</Kbd>
            </Button>
            <Button
              variant="outline"
              className={`${PTR} border-amber-300 text-amber-800 hover:bg-amber-50 hover:text-amber-900`}
              onClick={flagIssue}
              disabled={save.isPending || locked}
            >
              <Flag className="h-4 w-4" /> {t('dedup.review.flagIssue')} <Kbd>X</Kbd>
            </Button>
          </div>

          <div className="flex items-center justify-center gap-1.5 sm:justify-start lg:ml-auto">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">{t('dedup.review.confidence')}</span>
            {CONFIDENCE.map((n) => (
              <button
                key={n}
                onClick={() => setConfidence(confidence === n ? null : n)}
                disabled={locked}
                className={`h-9 w-9 cursor-pointer rounded-md border text-sm tabular-nums ${
                  confidence === n
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 text-gray-600 hover:border-gray-500'
                }`}
                title={t('dedup.review.confidenceN', { n: formatNumber(n) })}
                aria-pressed={confidence === n}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {fullText && (
        <FullTextDialog
          a={cardA}
          b={cardB}
          view={fullText}
          onViewChange={setFullText}
          onClose={() => setFullText(null)}
          onAddNote={canWriteNotes ? addNote : undefined}
        />
      )}

      <PreferredCopyDialog
        open={askPreferred}
        onOpenChange={setAskPreferred}
        a={cardA}
        b={cardB}
        current={item.verdict === 'same' ? preferred : undefined}
        onPick={saveSame}
      />

      <CantAnswerDialog
        open={dialog != null}
        onOpenChange={(o) => !o && setDialog(null)}
        item={{ ...item, issues }}
        start={dialog ?? 'default'}
        onSubmit={saveDialog}
      />
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-1 hidden rounded border border-current px-1 font-mono text-[10px] opacity-60 sm:inline">{children}</kbd>
  );
}
