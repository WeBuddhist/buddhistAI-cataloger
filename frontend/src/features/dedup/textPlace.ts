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
  return { pages: volume.pages, start: at[start], span: null, exact: false };
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
