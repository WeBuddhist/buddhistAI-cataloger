// Finds a selected passage in the other copy. The two copies come from different scans,
// so punctuation, spacing and line breaks rarely agree, and OCR changes single letters:
// matching ignores the first kind of difference and tolerates some of the second.

export type TextRange = { start: number; end: number };

export type TextMatches = {
  ranges: TextRange[];
  /** False when the best the text offers is a close match, not the same letters. */
  exact: boolean;
};

const NO_MATCHES: TextMatches = { ranges: [], exact: true };

// Tsheg, shad and similar marks, spaces, line breaks.
const IGNORED = /[\s་-༔_]/;
// Below this a selection is a syllable or two, found all over any text.
const MIN_LETTERS = 3;
const MIN_LETTERS_CLOSE = 12;
const MAX_MATCHES = 200;
const MAX_CANDIDATES = 50;
const MIN_SIMILARITY = 0.6;

/** The letters of `text`, and where each one sits in `text`. */
export function lettersOf(text: string): { letters: string; at: number[] } {
  const parts: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (IGNORED.test(text[i])) continue;
    parts.push(text[i]);
    at.push(i);
  }
  return { letters: parts.join(''), at };
}

function allIndexes(text: string, part: string, limit: number): number[] {
  const found: number[] = [];
  for (let i = text.indexOf(part); i >= 0 && found.length < limit; i = text.indexOf(part, i + part.length)) {
    found.push(i);
  }
  return found;
}

/** Dice coefficient over letter pairs: 1 = same letters, order barely matters. */
function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const p = a.slice(i, i + 2);
    pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const p = b.slice(i, i + 2);
    const left = pairs.get(p) ?? 0;
    if (left > 0) {
      pairs.set(p, left - 1);
      shared++;
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

/** Where the passage most likely sits, from short pieces of it that did survive the OCR. */
function closestStart(letters: string, wanted: string): number | null {
  const size = Math.max(6, Math.floor(wanted.length / 4));
  const offsets = [0, Math.floor((wanted.length - size) / 2), wanted.length - size];
  const starts = new Set<number>();
  for (const offset of offsets) {
    for (const i of allIndexes(letters, wanted.slice(offset, offset + size), MAX_CANDIDATES)) {
      starts.add(Math.max(0, i - offset));
    }
  }
  let best: number | null = null;
  let bestScore = MIN_SIMILARITY;
  for (const start of starts) {
    const score = similarity(wanted, letters.slice(start, start + wanted.length));
    if (score >= bestScore) {
      best = start;
      bestScore = score;
    }
  }
  return best;
}

/** Long enough to search for: a syllable or two would match everywhere. */
export function canSearch(selected: string): boolean {
  return lettersOf(selected).letters.length >= MIN_LETTERS;
}

export function findMatches(text: string, selected: string): TextMatches {
  const wanted = lettersOf(selected).letters;
  if (wanted.length < MIN_LETTERS) return NO_MATCHES;

  const { letters, at } = lettersOf(text);
  const toRange = (i: number, length: number): TextRange => ({
    start: at[i],
    end: at[Math.min(i + length, at.length) - 1] + 1,
  });

  const exact = allIndexes(letters, wanted, MAX_MATCHES);
  if (exact.length > 0) return { ranges: exact.map((i) => toRange(i, wanted.length)), exact: true };

  if (wanted.length < MIN_LETTERS_CLOSE) return NO_MATCHES;
  const close = closestStart(letters, wanted);
  return close == null ? NO_MATCHES : { ranges: [toRange(close, wanted.length)], exact: false };
}
