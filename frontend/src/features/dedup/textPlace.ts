// Where a text sits in a volume, so its scans can open at the right page. No imports from
// the app beyond the matching: every step here works on plain data.
import { lettersOf, type TextRange } from './textMatch';

export interface VolumePage {
  cstart: number;
  cend: number;
  pnum: number;
  pname: string;
}

export interface Volume {
  text: string;
  pages: VolumePage[];
}

export interface TextPlace {
  pages: VolumePage[];
  /** Character in the volume where the text starts. */
  start: number;
  /** Its length in the volume, when BDRC gives it. */
  span: number | null;
  /** False when found by searching a different OCR version: the page may be slightly off. */
  exact: boolean;
  /** The volume's text, to find a line in it by its words (`charOfWords`). */
  text?: string;
}

// Finding a line by its words. The volume can be another OCR of the same pages, so the
// words are matched by vote, as the text itself is: each short run of letters they share
// with the volume says where the line would start, and the place most agree on wins.
const LINE_LETTERS = 60;
const LINE_RUN = 5;
const MIN_LINE_LETTERS = 15;
const MIN_LINE_VOTES = 6;
const LINE_SLACK = 4;
// How far from the share's estimate the line is looked for: the estimate drifts with the
// difference in length between the two OCRs, a few percent of the text.
const MIN_LINE_WINDOW = 1500;

/**
 * The character of the volume where the line opening with `words` is, looked for around
 * `guess` (the estimate from how far through the text the line is). Null when the words
 * are too short or not found: the estimate is then the best there is.
 */
export function charOfWords(place: TextPlace, guess: number, words: string): number | null {
  if (!place.text) return null;
  const wanted = lettersOf(words).letters.slice(0, LINE_LETTERS);
  if (wanted.length < MIN_LINE_LETTERS) return null;
  const reach = Math.max(MIN_LINE_WINDOW, Math.round((place.span ?? 0) * 0.1));
  const from = Math.max(0, Math.round(guess) - reach);
  const { letters, at } = lettersOf(place.text.slice(from, Math.round(guess) + reach));
  const runs = new Map<string, number[]>();
  for (let k = 0; k + LINE_RUN <= wanted.length; k++) {
    const run = wanted.slice(k, k + LINE_RUN);
    const offsets = runs.get(run);
    if (offsets) offsets.push(k);
    else runs.set(run, [k]);
  }
  const votes = lineVotes(letters, runs);
  const best = bestVote(votes, (start) => Math.abs(from + (at[start] ?? 0) - guess));
  return best == null ? null : from + at[best];
}

/** Where each run of the line found in `letters` says it starts, with the run's place in the line. */
function lineVotes(letters: string, runs: Map<string, number[]>): { start: number; k: number }[] {
  const votes: { start: number; k: number }[] = [];
  for (let i = 0; i + LINE_RUN <= letters.length; i++) {
    const offsets = runs.get(letters.slice(i, i + LINE_RUN));
    if (offsets) for (const k of offsets) if (i >= k) votes.push({ start: i - k, k });
  }
  return votes.sort((a, b) => a.start - b.start);
}

/**
 * The place with the most votes within a few letters (the nearer to the guess on a tie).
 * Of its votes, the one from the run nearest the line's opening says where it starts: letters
 * the OCR dropped shift the votes of later runs earlier.
 */
function bestVote(votes: { start: number; k: number }[], distance: (start: number) => number): number | null {
  let best: number | null = null;
  let most = 0;
  let nearest = Infinity;
  for (let i = 0, j = 0; i < votes.length; i++) {
    while (votes[i].start - votes[j].start > LINE_SLACK) j++;
    const count = i - j + 1;
    let first = votes[j];
    for (let m = j + 1; m <= i; m++) if (votes[m].k < first.k) first = votes[m];
    const far = distance(first.start);
    if (count > most || (count === most && far < nearest)) {
      most = count;
      best = first.start;
      nearest = far;
    }
  }
  return most >= MIN_LINE_VOTES ? best : null;
}

const ENDS_LENGTH = 220;
// Poor OCR leaves few long stretches intact but many short ones, so the text is found by
// vote: each short run of letters it shares with the volume says where the text would start
// there, and the place most of them agree on wins. Runs seen all over the volume say nothing.
const RUN_LETTERS = 12;
const MAX_RUNS = 20000;
const MAX_REPEATS = 4;
const MIN_VOTES = 15;
const MIN_AGREEMENT = 0.3;

/** Where each shared run of letters says the text starts, in letters of the volume, sorted. */
function votes(volume: string, text: string): number[] {
  const step = Math.max(1, Math.floor(text.length / MAX_RUNS));
  const runs = new Map<string, number>();
  for (let i = 0; i + RUN_LETTERS <= text.length; i += step) {
    const run = text.slice(i, i + RUN_LETTERS);
    if (!runs.has(run)) runs.set(run, i);
  }
  const seen = new Map<string, number[]>();
  for (let i = 0; i + RUN_LETTERS <= volume.length; i++) {
    const run = volume.slice(i, i + RUN_LETTERS);
    if (!runs.has(run)) continue;
    const at = seen.get(run);
    if (at) at.push(i);
    else seen.set(run, [i]);
  }
  const starts: number[] = [];
  for (const [run, at] of seen) {
    if (at.length <= MAX_REPEATS) for (const i of at) starts.push(i - runs.get(run)!);
  }
  return starts.sort((a, b) => a - b);
}

/** Finds the text in a volume by wording, even through poor OCR. */
export function searchVolume(volume: Volume, text: string): TextPlace | null {
  const { letters, at } = lettersOf(volume.text);
  const wanted = lettersOf(text).letters;
  const starts = votes(letters, wanted);
  const window = Math.max(200, wanted.length * 0.2);
  let most = 0;
  let from = 0;
  for (let i = 0, j = 0; i < starts.length; i++) {
    while (starts[i] - starts[j] > window) j++;
    if (i - j + 1 > most) {
      most = i - j + 1;
      from = j;
    }
  }
  if (most < MIN_VOTES || most / starts.length < MIN_AGREEMENT) return null;
  const start = Math.max(0, starts[from + Math.floor(most / 2)]);
  return { pages: volume.pages, start: at[start], span: null, exact: false, text: volume.text };
}

/** The page holding a character; the one before it if the character falls between pages. */
export function pageAt(pages: VolumePage[], char: number): VolumePage | undefined {
  let held: VolumePage | undefined;
  for (const page of pages) {
    if (page.cstart > char) break;
    held = page;
  }
  return held;
}

/** The opening and ending of `text`, to find it by. */
export function textEnds(text: string): { head: string; tail: string } {
  return { head: text.slice(0, ENDS_LENGTH), tail: text.slice(-ENDS_LENGTH) };
}

/** About where the text sits in a volume. */
export function rangeInVolume(volume: string, text: string): TextRange | null {
  const place = searchVolume({ text: volume, pages: [] }, text);
  return place && { start: place.start, end: Math.min(volume.length, place.start + text.length) };
}
