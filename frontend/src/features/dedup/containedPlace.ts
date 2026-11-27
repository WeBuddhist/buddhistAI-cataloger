// Where the shorter text of a very unequal pair sits inside the longer one, so an
// annotator does not have to hunt for a short fragment in a long text. Worked out from
// BDRC's alignment (`evidence.diff_indicators`); no imports from the app beyond types.
import type { DiffIndicators } from './api/review';
import type { TextRange } from './textMatch';

export interface ContainedPlace {
  short: 'A' | 'B';
  long: 'A' | 'B';
  /** Lengths in syllables, as BDRC counts them. */
  shortLength: number;
  longLength: number;
  /** The matching part of the longer text, in its syllables: [start, end). */
  start: number;
  end: number;
}

// "Very unequal": the shorter text is at most half the longer one.
const MAX_LENGTH_RATIO = 0.5;

/** The matching part of the longer text, or null when the lengths are close or BDRC
 * found no run of matching syllables to place it by. */
export function containedPlace(d: DiffIndicators | null | undefined): ContainedPlace | null {
  const nA = d?.n_a;
  const nB = d?.n_b;
  const head = d?.head_extra;
  const tail = d?.tail_extra;
  if (!nA || !nB || head == null || tail == null) return null;
  // No anchor found: BDRC then reports 0 / 0, which says nothing about the place.
  if (d?.core_match_coverage === 0) return null;
  const longIsB = nB > nA;
  const shortLength = longIsB ? nA : nB;
  const longLength = longIsB ? nB : nA;
  if (shortLength / longLength > MAX_LENGTH_RATIO) return null;
  // The extras count B against A: turned round when A is the longer one.
  const sign = longIsB ? 1 : -1;
  const start = Math.min(longLength, Math.max(0, sign * head));
  const end = Math.max(start, longLength - Math.max(0, sign * tail));
  // Nothing before or after it, or nothing left between: not a place worth showing.
  if (end <= start || (start === 0 && end === longLength)) return null;
  return { short: longIsB ? 'A' : 'B', long: longIsB ? 'B' : 'A', shortLength, longLength, start, end };
}

// A syllable, as BDRC's tokenizer sees it: letters between tsheg, shad and spaces.
const SYLLABLE = /[^\s་༌།-༔]+/g;

/**
 * The characters of `text` (as shown) that hold syllables [start, end) of a text BDRC
 * counted as `total` syllables. Its count and ours can differ a little (OCR marks,
 * normalisation), so the place is scaled to our count: approximate, never exact.
 */
export function syllableChars(text: string, start: number, end: number, total: number): TextRange | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of text.matchAll(SYLLABLE)) {
    starts.push(m.index);
    ends.push(m.index + m[0].length);
  }
  const n = starts.length;
  if (n === 0 || total <= 0) return null;
  const scale = n / total;
  const first = Math.min(n - 1, Math.floor(start * scale));
  const last = Math.min(n - 1, Math.max(first, Math.ceil(end * scale) - 1));
  return { start: starts[first], end: ends[last] };
}
