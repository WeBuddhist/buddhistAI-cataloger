// Annotators' notes on a pair, kept in the decision's `partner_payload.notes`: the
// Cataloger stores it and BDRC receives it with the answer. A pair with no answer yet has
// nothing to save onto, so its notes and flagged issues wait in this browser as a draft
// and go with the answer.
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReviewIssue, SttRequest } from './api/review';
import { findMatches, lettersOf, type TextRange } from './textMatch';

export type NoteTarget = 'a' | 'b' | 'both';

/** What a note is about, from the annotation guidelines: how two copies of one text
 * differ, or why two texts are different works. Sent to BDRC as these ids. */
export const NOTE_KINDS = {
  same: ['content_missing', 'extra_content', 'outlining_issue', 'expanded_condensed', 'page_order', 'ocr', 'title'],
  different: ['totally_different', 'commentary', 'sadhana_instructions'],
} as const;
export type NoteKind = (typeof NOTE_KINDS)[keyof typeof NOTE_KINDS][number];

/** The kinds that are about a place in the text: such a note needs a passage selected
 * that points to one place, but no sentence. */
export const PLACE_KINDS: readonly NoteKind[] = [
  'content_missing',
  'extra_content',
  'outlining_issue',
  'expanded_condensed',
  'page_order',
  'ocr',
];

/** Below this many syllables a quote is found in many places, so it cannot say where the
 * note is (a lone ༔ or །།). */
export const MIN_QUOTE_SYLLABLES = 8;

/** Syllables of a passage: what lies between tshegs, shads, spaces and the like. */
export function syllableCount(text: string): number {
  return text.split(/[\s་-༔_]+/).filter((s) => s.length > 0).length;
}

/** What is wrong with the place of a note of `kinds` on `quote`: one of them is about a
 * place but there is no passage (`none`: it cannot be saved), or one too short to point to
 * one place (`short`: asked about before saving). Null when nothing is. */
export function missingPlace(kinds: readonly NoteKind[], quote: string | undefined): 'none' | 'short' | null {
  if (!kinds.some((k) => PLACE_KINDS.includes(k))) return null;
  if (!quote?.trim()) return 'none';
  if (syllableCount(quote) < MIN_QUOTE_SYLLABLES) return 'short';
  return null;
}

/** What the annotator checked the note against: the scan, a BDRC search, or nothing. */
export const NOTE_CHECKS = ['scan', 'bdrc', 'none'] as const;
export type NoteCheck = (typeof NOTE_CHECKS)[number];

/** The kinds that say why two texts are different works. */
export const REASON_KINDS: readonly NoteKind[] = NOTE_KINDS.different;

/** Whether one of `kinds` says why two texts are different works: such a note needs a sentence. */
export const hasReasonKind = (kinds: readonly NoteKind[]) => kinds.some((k) => REASON_KINDS.includes(k));

/** Whether `notes` say why the texts are different: a reason kind, with a sentence. */
export const givesReason = (notes: PairNote[]) => notes.some((n) => hasReasonKind(kindsOf(n)) && n.text.trim());

/** Whether `note` has a type that goes against `verdict`: a "same, but…" type on a
 * "different" answer, or a "different because…" type on a "same" one. */
export function goesAgainst(note: NoteDetails, verdict: 'same' | 'different'): boolean {
  const other: readonly NoteKind[] = verdict === 'same' ? NOTE_KINDS.different : NOTE_KINDS.same;
  return kindsOf(note).some((k) => other.includes(k));
}

/** A note's types, in the order chosen. Older notes hold one, as `kind`. */
export function kindsOf(note: NoteDetails): NoteKind[] {
  if (note.kinds?.length) return note.kinds;
  return note.kind ? [note.kind] : [];
}

/** What must be asked before saving `verdict`: why the texts are different (a reason note
 * is missing), why the answer goes against both annotators (`bothSaid`, when they agreed;
 * the person's own note with a sentence answers it, a note kept from an annotator does
 * not), or, for "different" with its reason already given, a last look at that reason
 * (`confirm-different`, where more notes can be added). Null for "same" with nothing to
 * ask: the preferred copy is asked next. */
export function askBeforeSaving(
  verdict: 'same' | 'different',
  notes: PairNote[],
  bothSaid: string | null,
): 'different' | 'override-same' | 'override-different' | 'confirm-different' | null {
  if (verdict === 'different' && !givesReason(notes)) return 'different';
  const explained = notes.some((n) => !n.adopted_from?.length && n.text.trim());
  if (bothSaid && bothSaid !== verdict && !explained) return verdict === 'same' ? 'override-same' : 'override-different';
  return verdict === 'different' ? 'confirm-different' : null;
}

/** A note's kinds and what it was checked against; all optional. */
export interface NoteDetails {
  /** The types chosen, in order; read through `kindsOf`. Sent to BDRC as this list. */
  kinds?: NoteKind[];
  /** Older notes' one type, before `kinds`; no longer written (an edit moves it to `kinds`). */
  kind?: NoteKind;
  checked?: NoteCheck;
  /** The scan page looked at, when checked on the scan. */
  page?: string;
  /** The BDRC work or instance found (W… / MW… id), when checked on BDRC. */
  witness_id?: string;
}

/** A BDRC id typed or pasted as the bare W… / MW… id: `MW22084`, `bdr:MW22084`, or a
 * library link, also one opened on an etext, where the work is only in `back=bdr%3AMW…`.
 * The text as typed when no such id is in it. */
export function bdrcId(typed: string): string {
  const found = /(?:^|[^0-9a-z])(?:bdr(?::|%3A))?(m?wa?\d[\w-]*)/i.exec(typed.trim());
  if (!found) return typed.trim();
  const id = found[1];
  // The prefix in capitals (mw22084 → MW22084); the rest as given.
  const prefix = /^mw/i.test(id) ? 2 : 1;
  return id.slice(0, prefix).toUpperCase() + id.slice(prefix);
}

/** `note` without details that are unset, and without a page or id unless checked where
 * they belong. */
function tidyDetails<T extends NoteDetails>(note: T): T {
  const next = { ...note };
  const kinds = [...new Set(kindsOf(note))];
  delete next.kinds;
  delete next.kind;
  if (kinds.length > 0) next.kinds = kinds;
  if (!next.checked) delete next.checked;
  if (next.checked !== 'scan' || !next.page?.trim()) delete next.page;
  else next.page = next.page.trim();
  if (next.checked !== 'bdrc' || !next.witness_id?.trim()) delete next.witness_id;
  else next.witness_id = bdrcId(next.witness_id);
  return next;
}

/** Where a passage is in one text, in the text BDRC's API serves for it (`/texts/{mw_id}`):
 * offsets in characters (code points), as Python counts them. `etext_source` and
 * `text_length` say which text that was, so a later change to it can be noticed. */
export interface SidePlace {
  start: number;
  end: number;
  etext_source: string | null;
  text_length: number | null;
}

/** A passage's place in each text it was found in: A's and B's offsets differ. */
export type NotePlace = Partial<Record<'a' | 'b', SidePlace>>;

/** Where a selection was on screen: which text, and its place in that text as displayed. */
export interface ShownAt {
  side: 'a' | 'b';
  range: TextRange;
}

export interface PairNote extends NoteDetails {
  id: string;
  /** The text that holds the quote (both when it is in both). For something missing, that
   * is the text that has it, not the one that lacks it. */
  target: NoteTarget;
  /** May be empty when the note has a kind, except a kind giving a reason. */
  text: string;
  /** The highlighted passage the note is about, when it is about one. */
  quote?: string;
  /** Where the passage is in each text it was found in. */
  range?: NotePlace;
  /** The annotators' notes an adjudicator took this one from (their ids). */
  adopted_from?: string[];
  /** The recordings behind a spoken note, oldest first (`dedup_voice_notes`, audio in
   * S3). Editing a note with the mic adds one; earlier ones are kept. */
  voice_note_ids?: string[];
  /** Older notes: a single recording. Read through `recordingIds`. */
  voice_note_id?: string;
  created_at: string;
  /** Set when the note was edited after it was first saved. */
  updated_at?: string;
}

/** Every recording behind a note, oldest first. */
export function recordingIds(note: PairNote): string[] {
  return [...(note.voice_note_id ? [note.voice_note_id] : []), ...(note.voice_note_ids ?? [])];
}

/** A spoken note's recording, waiting to be stored when the note is saved. */
export interface VoiceRecording {
  audio: Blob;
  stt: SttRequest[];
}

/** `shownAt`: where the selection was on screen, to place the passage by; it is not stored.
 * `range` is filled in from it, and from the texts, when the note is saved. */
export type NewNote = Pick<PairNote, 'target' | 'text' | 'quote' | 'range' | 'voice_note_ids' | 'adopted_from'> &
  NoteDetails & { recording?: VoiceRecording; shownAt?: ShownAt };

/** What an edit changes on a saved note; a new recording is added to its list. `quote`
 * (with `shownAt`) when adding to the note from a wider selection: its passage grows.
 * `range` is filled in when the edit is saved. */
export type NoteEdit = Pick<PairNote, 'target' | 'text'> &
  Partial<Pick<PairNote, 'quote' | 'range'>> &
  NoteDetails & { recording?: VoiceRecording; shownAt?: ShownAt };

/** The note as stored: the recording itself never goes into it, only its id. */
export function makeNote(added: NewNote): PairNote {
  const note: PairNote = tidyDetails({ ...added, id: crypto.randomUUID(), created_at: new Date().toISOString() });
  delete (note as NewNote).recording;
  delete (note as NewNote).shownAt;
  if (!note.voice_note_ids?.length) delete note.voice_note_ids;
  if (!note.adopted_from?.length) delete note.adopted_from;
  if (!note.range || Object.keys(note.range).length === 0) delete note.range;
  return note;
}

/** `note` after an edit; `newRecordingId` is the recording stored with this edit, if any. */
export function editedNote(note: PairNote, edit: NoteEdit, newRecordingId?: string): PairNote {
  const ids = [...recordingIds(note), ...(newRecordingId ? [newRecordingId] : [])];
  const next: PairNote = tidyDetails({
    ...note,
    target: edit.target,
    text: edit.text,
    kinds: kindsOf(edit),
    kind: undefined,
    checked: edit.checked,
    page: edit.page,
    witness_id: edit.witness_id,
    ...(edit.quote ? { quote: edit.quote } : {}),
    // Placed again when the edit was saved; kept as it was when that was not possible.
    ...(edit.range ? { range: edit.range } : {}),
    updated_at: new Date().toISOString(),
  });
  if (!next.range || Object.keys(next.range).length === 0) delete next.range;
  delete next.voice_note_id;
  if (ids.length) next.voice_note_ids = ids;
  else delete next.voice_note_ids;
  return next;
}

/** The note, among `notes`, already on the passage selected in `shown` (one text as shown
 * on screen): its quote is found there over the selected place, or, when the selection's
 * place is not known, one quote holds the other. */
export function noteOnPassage(
  notes: PairNote[],
  side: 'a' | 'b',
  shown: string,
  selected: { text: string; range?: TextRange },
): PairNote | undefined {
  const picked = lettersOf(selected.text).letters;
  if (!picked) return undefined;
  return notes.find((n) => {
    if (!n.quote || (n.target !== side && n.target !== 'both')) return false;
    const range = selected.range;
    if (!range) {
      const quoted = lettersOf(n.quote).letters;
      return quoted.length > 0 && (quoted.includes(picked) || picked.includes(quoted));
    }
    const found = findMatches(shown, n.quote);
    return found.exact && found.ranges.some((r) => r.start < range.end && range.start < r.end);
  });
}

/** The passage a note covers once a new selection is added to it: from the earlier of the
 * two starts to the later of the two ends, as shown in `shown`. Undefined when the note's
 * passage cannot be placed there, or the selection already lies within it. */
export function widenedPassage(
  note: PairNote,
  shown: string,
  selected: { text: string; range?: TextRange },
): { quote: string; range: TextRange } | undefined {
  const sel = selected.range;
  if (!note.quote || !sel) return undefined;
  const found = findMatches(shown, note.quote);
  const old = found.exact ? found.ranges.find((r) => r.start < sel.end && sel.start < r.end) : undefined;
  if (!old || (sel.start >= old.start && sel.end <= old.end)) return undefined;
  const range = { start: Math.min(old.start, sel.start), end: Math.max(old.end, sel.end) };
  return { quote: shown.slice(range.start, range.end), range };
}

/** A text as BDRC's API serves it, to place a note's passage in. */
export interface ServedText {
  text_bo: string;
  etext_source: string | null;
  text_length: number | null;
}

/** `offset` (in UTF-16 units, as JavaScript counts) in code points, as Python counts. */
function codePoints(text: string, offset: number): number {
  return Array.from(text.slice(0, offset)).length;
}

/** `found` (the quote's letters, matched in `text`) widened over the punctuation the
 * quote starts or ends with (a tsheg, a shad), where the text has it too: the place then
 * holds exactly the quote. */
function withEdges(text: string, quote: string, found: TextRange): TextRange {
  const { at } = lettersOf(quote);
  if (at.length === 0) return found;
  const lead = quote.slice(0, at[0]);
  const trail = quote.slice(at.at(-1)! + 1);
  let { start, end } = found;
  if (lead && text.slice(start - lead.length, start) === lead) start -= lead.length;
  if (trail && text.slice(end, end + trail.length) === trail) end += trail.length;
  return { start, end };
}

/**
 * Where `quote` is in each text the note is on, in the texts as served. `near` gives, per
 * side, about where the passage is (where it was selected, or its earlier place): of
 * several matches, the nearest is taken. Without it, a passage found more than once is
 * left unplaced on that side rather than guessed. The texts on screen differ from the
 * served ones only in blank lines, so a place on screen is close to the served one.
 */
export function placePassage(
  quote: string,
  target: NoteTarget,
  texts: Partial<Record<'a' | 'b', ServedText | null>>,
  near: Partial<Record<'a' | 'b', number>> = {},
): NotePlace {
  const place: NotePlace = {};
  for (const side of target === 'both' ? (['a', 'b'] as const) : [target]) {
    const served = texts[side];
    if (!served?.text_bo) continue;
    const { ranges } = findMatches(served.text_bo, quote);
    const at = near[side];
    let found: TextRange | undefined;
    if (at != null && ranges.length > 0) {
      found = ranges.reduce((best, r) => (Math.abs(r.start - at) < Math.abs(best.start - at) ? r : best), ranges[0]);
    } else if (ranges.length === 1) {
      found = ranges[0];
    }
    if (!found) continue;
    const { start, end } = withEdges(served.text_bo, quote, found);
    place[side] = {
      start: codePoints(served.text_bo, start),
      end: codePoints(served.text_bo, end),
      etext_source: served.etext_source,
      text_length: served.text_length,
    };
  }
  return place;
}

/** Letters in a row that, found in another quote, show the two passages overlap. */
const OVERLAP_LETTERS = 12;

/** Whether two notes say something about the same place: their passages overlap in a
 * text they share, or, without passages, they have the same kind. */
export function samePlace(x: PairNote, y: PairNote): boolean {
  if (!x.quote || !y.quote) return !x.quote && !y.quote && kindsOf(x).some((k) => kindsOf(y).includes(k));
  if (x.target !== y.target && x.target !== 'both' && y.target !== 'both') return false;
  for (const side of ['a', 'b'] as const) {
    const p = x.range?.[side];
    const q = y.range?.[side];
    if (p && q) return p.start < q.end && q.start < p.end;
  }
  const lx = lettersOf(x.quote).letters;
  const ly = lettersOf(y.quote).letters;
  if (!lx || !ly) return false;
  if (lx.includes(ly) || ly.includes(lx)) return true;
  // Passages that run into each other: one's start or end is in the other.
  const ends = (s: string) => (s.length >= OVERLAP_LETTERS ? [s.slice(0, OVERLAP_LETTERS), s.slice(-OVERLAP_LETTERS)] : []);
  return ends(ly).some((e) => lx.includes(e)) || ends(lx).some((e) => ly.includes(e));
}

/** `items` in groups of notes about the same place, in the order first met. */
export function groupBySamePlace<T extends { note: PairNote }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const joined = groups.filter((g) => g.some((other) => samePlace(other.note, item.note)));
    // A note can link two groups that had nothing in common: they become one.
    const merged = [...joined.flat(), item];
    for (const g of joined) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  // Back in the order the notes came.
  const order = new Map(items.map((item, i) => [item, i]));
  return groups.sort((g, h) => Math.min(...g.map((i) => order.get(i)!)) - Math.min(...h.map((i) => order.get(i)!)));
}

/** One note made from several notes about the same place (an adjudicator keeping them as
 * one): the widest passage, every text, every kind, and the first check given. */
export function mergedNote(notes: PairNote[]): NewNote {
  const widest = notes.reduce((w, n) => ((n.quote?.length ?? 0) > (w.quote?.length ?? 0) ? n : w), notes[0]);
  const targets = new Set(notes.map((n) => n.target));
  const texts = [...new Set(notes.map((n) => n.text.trim()).filter(Boolean))];
  const checked = notes.find((n) => n.checked);
  return {
    target: targets.size === 1 ? notes[0].target : 'both',
    text: texts.join('\n'),
    quote: widest.quote,
    // Only kept when every note is on the same text: it may need placing in the other too.
    range: targets.size === 1 ? widest.range : undefined,
    kinds: [...new Set(notes.flatMap(kindsOf))],
    checked: checked?.checked,
    page: checked?.page,
    witness_id: checked?.witness_id,
    voice_note_ids: notes.flatMap(recordingIds),
    adopted_from: notes.map((n) => n.id),
  };
}

/** The span from `seed` over every place that overlaps it, directly or through another
 * one: a place found far away must not stretch it across the text. */
function spanOverlapping(places: TextRange[], seed: TextRange): TextRange {
  let { start, end } = seed;
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of places) {
      const overlaps = p.start <= end && start <= p.end;
      if (overlaps && (p.start < start || p.end > end)) {
        start = Math.min(start, p.start);
        end = Math.max(end, p.end);
        grew = true;
      }
    }
  }
  return { start, end };
}

/**
 * The passage covering all of `notes`' passages (merged notes about one place): on each
 * text the merged note is on, from the earliest start to the latest end of theirs, and the
 * quote taken from that span. A passage is placed by its own `range`, or else looked for
 * near the longest one. Undefined when none can be placed.
 */
export function unionPassage(
  notes: PairNote[],
  target: NoteTarget,
  texts: Partial<Record<'a' | 'b', ServedText | null>>,
): { quote: string; range: NotePlace } | undefined {
  const range: NotePlace = {};
  for (const side of target === 'both' ? (['a', 'b'] as const) : [target]) {
    const served = texts[side];
    const on = notes.filter((n) => n.quote && (n.target === side || n.target === 'both'));
    if (!served?.text_bo || on.length === 0) continue;
    const longest = on.reduce((w, n) => (n.quote!.length > w.quote!.length ? n : w), on[0]);
    const anchor = longest.range?.[side] ?? placePassage(longest.quote!, side, { [side]: served })[side];
    const places = on
      .map((n) => n.range?.[side] ?? placePassage(n.quote!, side, { [side]: served }, anchor ? { [side]: anchor.start } : {})[side])
      .filter((p): p is SidePlace => p != null);
    if (places.length === 0) continue;
    const { start, end } = spanOverlapping(places, anchor ?? places[0]);
    range[side] = { start, end, etext_source: served.etext_source, text_length: served.text_length };
  }
  let quoteSide: 'a' | 'b' = range.a ? 'a' : 'b';
  if (target !== 'both') quoteSide = target;
  const span = range[quoteSide];
  const text = texts[quoteSide]?.text_bo;
  if (!span || !text) return undefined;
  // Offsets are in code points.
  return { quote: Array.from(text).slice(span.start, span.end).join(''), range };
}

/** A note an adjudicator keeps from an annotator's answer, as theirs. */
export function keptNote(note: PairNote): NewNote {
  // Only what the note says: who wrote it and when is the adjudicator's now.
  return {
    target: note.target,
    text: note.text,
    quote: note.quote,
    range: note.range,
    kinds: kindsOf(note),
    checked: note.checked,
    page: note.page,
    witness_id: note.witness_id,
    voice_note_ids: recordingIds(note),
    adopted_from: [note.id],
  };
}

/** Set on a panel or dialog open over the full-text window: the window leaves Esc to it. */
export const KEEPS_ESCAPE = 'data-keeps-escape';

/** The person's notes on this pair, for the notes button and for checking a new note
 * against. `onEdit` and `onRemove` are left out where they can only be read; `pending`
 * when there is no answer yet to save them onto. */
export const PairNotesContext = createContext<{
  notes: PairNote[];
  onEdit?: (id: string, edit: NoteEdit) => Promise<void> | void;
  onRemove?: (id: string) => void;
  pending?: boolean;
  /** Asks the texts on the page, or in the full-text window, to show a note's passage. */
  onShow?: (note: PairNote, where: NotesPlace) => void;
  /** The latest such request; `seq` tells a new one from the last. */
  showing?: { note: PairNote; where: NotesPlace; seq: number } | null;
}>({ notes: [] });

/** Where texts are shown: on the pair page, or in the full-text window over it. */
export type NotesPlace = 'page' | 'window';

export function notesOf(payload: Record<string, unknown> | null | undefined): PairNote[] {
  const notes = payload?.notes;
  return Array.isArray(notes) ? (notes as PairNote[]) : [];
}

/** `payload` with its notes replaced; null when nothing is left to store. */
export function withNotes(payload: Record<string, unknown> | null | undefined, notes: PairNote[]) {
  const next: Record<string, unknown> = { ...payload };
  delete next.notes;
  if (notes.length > 0) next.notes = notes;
  return Object.keys(next).length > 0 ? next : null;
}

interface Draft {
  notes: PairNote[];
  /** The pair's whole issue list to send with the answer; empty when none was flagged. */
  issues: ReviewIssue[];
}

const EMPTY: Draft = { notes: [], issues: [] };

/** A draft note from before passages were placed per text kept a place on screen
 * (`{start, end}`), which BDRC cannot use: it is dropped. */
function withoutShownPlace(note: PairNote): PairNote {
  if (!note.range || !('start' in note.range)) return note;
  const next = { ...note };
  delete next.range;
  return next;
}
const draftKey = (itemId: number) => `dedup.draft.${itemId}`;

function readDraft(itemId: number | undefined): Draft {
  if (itemId == null) return EMPTY;
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(itemId)) ?? 'null') as Partial<Draft> | null;
    return { notes: (saved?.notes ?? []).map((n) => withoutShownPlace(n)), issues: saved?.issues ?? [] };
  } catch {
    return EMPTY;
  }
}

function writeDraft(itemId: number, draft: Draft) {
  try {
    if (draft.notes.length === 0 && draft.issues.length === 0) localStorage.removeItem(draftKey(itemId));
    else localStorage.setItem(draftKey(itemId), JSON.stringify(draft));
  } catch {
    // Private window or blocked storage: the draft lasts until the page is left.
  }
}

/** What is waiting for this pair's answer. Survives moving between pairs and reloads. */
export function usePairDraft(itemId: number | undefined) {
  const [loaded, setLoaded] = useState({ itemId, draft: readDraft(itemId) });
  useEffect(() => {
    setLoaded({ itemId, draft: readDraft(itemId) });
  }, [itemId]);
  // The render right after moving to another pair must not show the last pair's draft.
  const draft = loaded.itemId === itemId ? loaded.draft : EMPTY;

  const update = useCallback(
    (change: (d: Draft) => Draft) => {
      if (itemId == null) return;
      const next = change(readDraft(itemId));
      writeDraft(itemId, next);
      setLoaded({ itemId, draft: next });
    },
    [itemId],
  );

  const addNote = useCallback((note: PairNote) => update((d) => ({ ...d, notes: [...d.notes, note] })), [update]);
  const removeNote = useCallback(
    (id: string) => update((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) })),
    [update],
  );
  const replaceNote = useCallback(
    (note: PairNote) => update((d) => ({ ...d, notes: d.notes.map((n) => (n.id === note.id ? note : n)) })),
    [update],
  );
  const setIssues = useCallback((issues: ReviewIssue[]) => update((d) => ({ ...d, issues })), [update]);
  const clear = useCallback(() => update(() => EMPTY), [update]);

  return useMemo(
    () => ({ ...draft, addNote, removeNote, replaceNote, setIssues, clear }),
    [draft, addNote, removeNote, replaceNote, setIssues, clear],
  );
}
