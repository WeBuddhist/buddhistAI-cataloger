import { fromWylie } from 'jsewts';
import type { AuthorAnswer, DuplicateReport, TextVersion } from './types';

const TIBETAN = /[ༀ-࿿]/;

export const hasTibetan = (text: string) => TIBETAN.test(text);

/** It has a BDRC page to open: its own, or its collection's. */
export const isOnBdrc = (version: TextVersion) => Boolean(version.bdrcId || version.collection);

/** BDRC writes names in Wylie, often with a closing "/". */
export const trimLabel = (label: string) => label.replace(/[\s/]+$/, '');

export function wylieToTibetan(wylie: string): string {
  const text = trimLabel(wylie);
  try {
    return fromWylie(text).replace(/[་\s]+$/, '');
  } catch {
    return text;
  }
}

/** A name as typed or selected, without line breaks and closing punctuation. */
export const cleanName = (name: string) =>
  name.replace(/\s+/g, ' ').trim().replace(/[་།༎༔\s]+$/, '').replace(/^[་།༎༔\s]+/, '');

// Enough to get past a title in front or an ending behind, without a long wait: each part
// is a search of its own.
const MAX_PARTS = 12;
const MAX_PART_SYLLABLES = 8;

/**
 * Shorter forms of a name, longest first: its ending (a title in front dropped) and its
 * beginning (an added ending dropped). BDRC only matches the whole phrase, so a name with a
 * title in front can find nobody.
 */
export function nameParts(name: string): string[] {
  const tibetan = hasTibetan(name);
  const syllables = name.split(tibetan ? /[་།\s]+/ : /\s+/).filter(Boolean);
  const joiner = tibetan ? '་' : ' ';
  const parts = new Set<string>();
  for (let n = Math.min(syllables.length - 1, MAX_PART_SYLLABLES); n >= 2; n -= 1) {
    parts.add(syllables.slice(-n).join(joiner));
    parts.add(syllables.slice(0, n).join(joiner));
  }
  return [...parts].slice(0, MAX_PARTS);
}

export function answerLabel(answer: AuthorAnswer): string {
  if (answer.kind === 'person') return `${answer.name} · ${answer.personId}`;
  if (answer.kind === 'not_in_bdrc') return `${answer.name} · not in BDRC`;
  return 'I don’t know';
}

export const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A person's report, leaving out those found to be two different people. */
export const reportOf = (personId: string, reports: DuplicateReport[] = []) =>
  reports.find((r) => r.decision?.kind !== 'different' && r.persons.some((p) => p.id === personId)) ?? null;

/** The report of these two persons, whatever was decided. */
export const reportOfPair = (a: string, b: string, reports: DuplicateReport[] = []) =>
  reports.find((r) => r.persons.every((p) => p.id === a || p.id === b)) ?? null;
