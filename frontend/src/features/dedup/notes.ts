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
  same: ['content_missing', 'extra_content', 'outlining_issue', 'page_order', 'ocr', 'title'],
  different: ['totally_different', 'commentary', 'sadhana_instructions'],
} as const;
export type NoteKind = (typeof NOTE_KINDS)[keyof typeof NOTE_KINDS][number];

/** A kind that marks a spot (where the text should be split), so a short quote is enough. */
export const MARKS_A_SPOT: NoteKind = 'outlining_issue';

/** What the annotator checked the note against: the scan, a BDRC search, or nothing. */
export const NOTE_CHECKS = ['scan', 'bdrc', 'none'] as const;
export type NoteCheck = (typeof NOTE_CHECKS)[number];

/** A note's kind and what it was checked against; all optional. */
export interface NoteDetails {
  kind?: NoteKind;
  checked?: NoteCheck;
  /** The scan page looked at, when checked on the scan. */
  page?: string;
}

/** `note` without details that are unset, and without a page unless checked on the scan. */
function tidyDetails<T extends NoteDetails>(note: T): T {
  const next = { ...note };
  if (!next.kind) delete next.kind;
  if (!next.checked) delete next.checked;
  if (next.checked !== 'scan' || !next.page?.trim()) delete next.page;
  else next.page = next.page.trim();
  return next;
}

export interface PairNote extends NoteDetails {
  id: string;
  target: NoteTarget;
  /** May be empty when the note has a kind. */
  text: string;
  /** The highlighted passage the note is about, when it is about one. */
  quote?: string;
  /** Where the passage sits in that text as displayed. */
  range?: TextRange;
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

export type NewNote = Pick<PairNote, 'target' | 'text' | 'quote' | 'range' | 'voice_note_ids'> &
  NoteDetails & { recording?: VoiceRecording };

/** What an edit changes on a saved note; a new recording is added to its list. */
export type NoteEdit = Pick<PairNote, 'target' | 'text'> & NoteDetails & { recording?: VoiceRecording };

/** The note as stored: the recording itself never goes into it, only its id. */
export function makeNote(added: NewNote): PairNote {
  const note: PairNote = tidyDetails({ ...added, id: crypto.randomUUID(), created_at: new Date().toISOString() });
  delete (note as NewNote).recording;
  if (!note.voice_note_ids?.length) delete note.voice_note_ids;
  return note;
}

/** `note` after an edit; `newRecordingId` is the recording stored with this edit, if any. */
export function editedNote(note: PairNote, edit: NoteEdit, newRecordingId?: string): PairNote {
  const ids = [...recordingIds(note), ...(newRecordingId ? [newRecordingId] : [])];
  const next: PairNote = tidyDetails({
    ...note,
    target: edit.target,
    text: edit.text,
    kind: edit.kind,
    checked: edit.checked,
    page: edit.page,
    updated_at: new Date().toISOString(),
  });
  delete next.voice_note_id;
  if (ids.length) next.voice_note_ids = ids;
  else delete next.voice_note_ids;
  return next;
}

/** Below this many syllables a quote is found in many places, so it cannot say where the
 * note is (a lone ༔ or །།). */
export const MIN_QUOTE_SYLLABLES = 8;

/** Syllables of a passage: what lies between tshegs, shads, spaces and the like. */
export function syllableCount(text: string): number {
  return text.split(/[\s་-༔_]+/).filter((s) => s.length > 0).length;
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
const draftKey = (itemId: number) => `dedup.draft.${itemId}`;

function readDraft(itemId: number | undefined): Draft {
  if (itemId == null) return EMPTY;
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(itemId)) ?? 'null') as Partial<Draft> | null;
    return { notes: saved?.notes ?? [], issues: saved?.issues ?? [] };
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
