// Annotators' notes on a pair, kept in the decision's `partner_payload.notes`: the
// Cataloger stores it and BDRC receives it with the answer. A pair with no answer yet has
// nothing to save onto, so its notes and flagged issues wait in this browser as a draft
// and go with the answer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReviewIssue } from './api/review';
import type { TextRange } from './textMatch';

export type NoteTarget = 'a' | 'b' | 'both';

export interface PairNote {
  id: string;
  target: NoteTarget;
  text: string;
  /** The highlighted passage the note is about, when it is about one. */
  quote?: string;
  /** Where the passage sits in that text as displayed. */
  range?: TextRange;
  created_at: string;
}

export type NewNote = Pick<PairNote, 'target' | 'text' | 'quote' | 'range'>;

export function makeNote(note: NewNote): PairNote {
  return { ...note, id: crypto.randomUUID(), created_at: new Date().toISOString() };
}

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
  const setIssues = useCallback((issues: ReviewIssue[]) => update((d) => ({ ...d, issues })), [update]);
  const clear = useCallback(() => update(() => EMPTY), [update]);

  return useMemo(() => ({ ...draft, addNote, removeNote, setIssues, clear }), [draft, addNote, removeNote, setIssues, clear]);
}
