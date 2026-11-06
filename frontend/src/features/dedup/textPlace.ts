// Where a text sits in a volume, so its scans can open at the right page. No imports from
// the app beyond the matching: every step here works on plain data.
import { findMatches, type TextRange } from './textMatch';

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
// Short stretches survive OCR differences that a long one does not, but a short stretch can
// also turn up in the wrong place (liturgies repeat), so several have to agree.
const PROBE_LENGTH = 70;
const PROBE_COUNT = 12;
const MIN_AGREEING = 2;

/** Stretches spread through the text, each with how far into the text it starts. */
function probes(text: string): { at: number; part: string }[] {
  const last = Math.max(0, text.length - PROBE_LENGTH);
  const step = last / (PROBE_COUNT - 1);
  return Array.from({ length: PROBE_COUNT }, (_, i) => {
    const at = Math.round(i * step);
    return { at, part: text.slice(at, at + PROBE_LENGTH) };
  });
}

/** Finds the text in a volume by wording: where most of its stretches say it starts. */
export function searchVolume(volume: Volume, text: string): TextPlace | null {
  const starts = probes(text)
    .flatMap(({ at, part }) => findMatches(volume.text, part).ranges.slice(0, 5).map((r) => r.start - at))
    .sort((a, b) => a - b);
  const window = Math.max(300, text.length * 0.15);
  let best: number[] = [];
  for (let i = 0, j = 0; i < starts.length; i++) {
    while (starts[i] - starts[j] > window) j++;
    if (i - j + 1 > best.length) best = starts.slice(j, i + 1);
  }
  if (best.length < MIN_AGREEING) return null;
  return { pages: volume.pages, start: Math.max(0, best[Math.floor(best.length / 2)]), span: null, exact: false };
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
