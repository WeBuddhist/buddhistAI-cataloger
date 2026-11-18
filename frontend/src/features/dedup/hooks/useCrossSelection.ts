// Selecting text, the same on every screen that shows the two copies: the passage is
// looked for in the other copy, and can get a note.
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PairNotesContext, type NotesPlace, type PairNote } from '../notes';
import { canSearch, findMatches, type TextRange } from '../textMatch';
import { formatNumber } from '../utils';

export type Tag = 'A' | 'B';

export type Picked = { text: string; range?: TextRange };

export type Marks = {
  ranges: TextRange[];
  active: number;
  follow: boolean;
  /** The selected words, when their place is not known: the opening or ending was selected. */
  quote?: string;
  /** Set on the selection's own side: its marks carry it as `data-own`, so the browser's
   * selection can be put back over them. */
  own?: string;
};

// Marking the selection re-renders the words under it, and the browser drops its own
// selection with them: Ctrl/Cmd+C would copy nothing. So it is put back over the marks.
function reselectMarks(own: string) {
  const marks = document.querySelectorAll(`mark[data-own="${CSS.escape(own)}"]`);
  const selection = window.getSelection();
  if (!selection || marks.length === 0) return;
  // Typing in the note form must keep its caret.
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
  const range = document.createRange();
  range.setStartBefore(marks[0]);
  range.setEndAfter(marks[marks.length - 1]);
  selection.removeAllRanges();
  selection.addRange(range);
}

const NO_MARKS: Marks = { ranges: [], active: 0, follow: false };

const otherSide = (side: Tag): Tag => (side === 'A' ? 'B' : 'A');

// Selecting on one side stays on that side: a drag cannot run into the other copy, which
// in the rows of the split view it otherwise does.
export const ONE_SIDE_SELECTION =
  '[&[data-selecting=A]_[data-side=B]]:select-none [&[data-selecting=B]_[data-side=A]]:select-none';

export function noteSelectingSide(e: PointerEvent<HTMLElement>) {
  const side = (e.target as HTMLElement).closest<HTMLElement>('[data-side]')?.dataset.side;
  if (side) e.currentTarget.dataset.selecting = side;
  else delete e.currentTarget.dataset.selecting;
}

/** What is selected inside `el`, with its place in the element's text. */
export function selectionIn(el: HTMLElement): Required<Picked> | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const text = range.toString();
  return text.trim() ? { text, range: { start, end: start + text.length } } : null;
}

/** Where a note's passage is in the texts shown: its own text first, then the other one
 * for a note on both. */
function placeOf(note: PairNote, shown: Record<Tag, string>): (Required<Picked> & { side: Tag }) | null {
  if (!note.quote) return null;
  const sides: Tag[] = note.target === 'b' ? ['B', 'A'] : ['A', 'B'];
  for (const side of note.target === 'both' ? sides : sides.slice(0, 1)) {
    const range = shown[side] ? findMatches(shown[side], note.quote).ranges[0] : undefined;
    if (range) return { side, text: shown[side].slice(range.start, range.end), range };
  }
  return null;
}

/** `where`: which texts these are, so a note's passage is shown where its notes button
 * was clicked. Left out where notes are not listed. */
export function useCrossSelection(shown: Record<Tag, string>, where?: NotesPlace) {
  const { t } = useTranslation();
  const own = useId();
  const [selected, setSelected] = useState<(Picked & { side: Tag }) | null>(null);
  // Set when the selection was made from the notes list: the texts scroll to it then, and
  // the browser's selection is not put over it (only our highlight shows).
  const [jumped, setJumped] = useState(false);
  useLayoutEffect(() => {
    if (selected && !jumped) reselectMarks(own);
  }, [selected, jumped, own]);
  // Without the browser's selection, Ctrl/Cmd+C copies the shown passage itself, unless
  // something else has been selected since.
  const jumpedText = jumped ? selected?.text : undefined;
  useEffect(() => {
    if (!jumpedText) return;
    const onCopy = (e: ClipboardEvent) => {
      if (window.getSelection()?.toString() || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', jumpedText);
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [jumpedText]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [noting, setNoting] = useState(false);
  const { showing } = useContext(PairNotesContext);
  // Only requests made after these texts were shown: a view opened later does not jump.
  const handled = useRef(showing?.seq ?? 0);
  useEffect(() => {
    if (!showing || showing.seq === handled.current || showing.where !== where) return;
    handled.current = showing.seq;
    const place = placeOf(showing.note, shown);
    if (!place) {
      toast.error(t('dedup.notes.notFoundHere'));
      return;
    }
    window.getSelection()?.removeAllRanges();
    setNoting(false);
    setSelected(place);
    setMatchIndex(0);
    setJumped(true);
  }, [showing, where, shown, t]);
  const searchIn = selected ? otherSide(selected.side) : null;
  const searchText = searchIn ? shown[searchIn] : '';
  const selectedText = selected?.text;
  const matches = useMemo(
    () => (selectedText && searchText ? findMatches(searchText, selectedText) : null),
    [searchText, selectedText],
  );
  const found = matches?.ranges.length ?? 0;

  const select = useCallback(
    (side: Tag, picked: Picked | null) => {
      if (noting) return;
      setSelected(picked && { side, ...picked });
      setMatchIndex(0);
      setJumped(false);
    },
    [noting],
  );
  const clear = useCallback(() => {
    setSelected(null);
    setNoting(false);
    setJumped(false);
  }, []);
  const step = (by: number) => setMatchIndex((i) => (i + by + found) % found);

  // The selection stays marked on its own side, and the matches on the other.
  const marksFor = (side: Tag): Marks => {
    if (!selected) return NO_MARKS;
    if (selected.side === side) {
      return selected.range
        ? { ranges: [selected.range], active: 0, follow: jumped, own }
        : { ...NO_MARKS, quote: selected.text, own };
    }
    return { ranges: matches?.ranges ?? [], active: matchIndex, follow: true };
  };

  let status = '';
  if (selected && searchIn) {
    const tag = searchIn;
    if (!canSearch(selected.text)) status = t('dedup.fullText.tooShort');
    else if (!searchText) status = t('dedup.fullText.searching');
    else if (found === 0) status = t('dedup.fullText.notFoundIn', { tag });
    else if (matches?.exact) status = t('dedup.fullText.foundIn', { tag, n: formatNumber(matchIndex + 1), total: formatNumber(found) });
    else status = t('dedup.fullText.closeMatchIn', { tag });
  }

  return { selected, found, select, clear, step, marksFor, status, noting, setNoting, shown, jumped };
}

export type CrossSelection = ReturnType<typeof useCrossSelection>;

/** Scrolls the returned container to its active mark when `key` changes; the page stays put. */
export function useScrollToMark(key: unknown, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const mark = box?.querySelector('mark[data-active],[data-active-row]');
    if (!enabled || !box || !mark) return;
    const offset = mark.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop += offset - box.clientHeight / 2;
  }, [key, enabled]);
  return ref;
}
