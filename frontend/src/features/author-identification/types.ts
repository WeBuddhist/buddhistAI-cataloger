import type { SkipReason } from './guidelines';

/** One copy of a text. `bdrcId` is null when the copy has no page of its own on BDRC. */
export interface TextVersion {
  id: string;
  bdrcId: string | null;
  /** Null when the copy is not in any BDRC collection (e.g. a local upload). */
  collection: { name: string; bdrcId: string } | null;
  /** Its title, as BDRC has it. */
  title: string | null;
  /** The author's name as written in this version, when one was found. */
  nameInVersion: string | null;
  /** Its scans on BDRC. */
  scansUrl: string | null;
  /** The version the text comes from. */
  base: boolean;
}

/** What BDRC's records say about a version; null where they say nothing. */
export interface VersionDetails {
  /** Recorded for this version itself. */
  author: string | null;
  printed: string | null;
  date: string | null;
  publisher: string | null;
  size: string | null;
  script: string | null;
}

/** A name found in the text or in one of its versions. */
export interface ExtractedName {
  name: string;
  /** 0 to 1; BDRC gives none for now. */
  confidence: number | null;
  /** The version it was found in; null for the text itself. */
  versionId: string | null;
  /** Quoted from there. */
  evidence: string | null;
}

/** The same name, with everywhere it was found. */
export interface NameCandidate {
  name: string;
  confidence: number | null;
  found: { versionId: string | null; evidence: string | null }[];
}

/** One deduplicated text to find the author of. `id` is its place in the batch. */
export interface AuthorTask {
  id: string;
  /** BDRC's id of the text (edition). */
  editionId: string;
  title: string;
  content: string;
  versions: TextVersion[];
  /** They can differ from one version to another. */
  extractedNames: ExtractedName[];
}

export interface BdrcPerson {
  id: string;
  nameBo: string;
  /** Another name of theirs, when that is what the search matched. */
  matchedName: string | null;
  dates: string | null;
}

export interface PersonPage {
  total: number;
  persons: BdrcPerson[];
}

/** A shorter form of a name that does find someone. */
export interface NameSuggestion {
  name: string;
  total: number;
}

/** The note can name a co-author, as a text has one author here. */
export type AuthorAnswer = { note: string } & (
  | { kind: 'person'; personId: string; name: string }
  | { kind: 'not_in_bdrc'; name: string }
  | { kind: 'skipped'; reason: SkipReason }
);

export type SavedAnswer = AuthorAnswer & { savedAt: string };

/** One of my texts, as listed. */
export interface TaskSummary {
  id: string;
  title: string;
  versionCount: number;
  extractedNames: ExtractedName[];
  /** Null while it is to do. */
  answer: SavedAnswer | null;
}

export type DuplicateDecision = 'same' | 'different';

/** Two BDRC persons reported as one and the same. Nothing changes in BDRC by it. */
export interface DuplicateReport {
  id: string;
  persons: [BdrcPerson, BdrcPerson];
  reason: string;
  /** The text it was noticed on. */
  text: { id: string; title: string };
  reportedBy: string;
  reportedAt: string;
  /** Null while it is to be checked. */
  decision: { kind: DuplicateDecision; note: string; by: string; at: string } | null;
}

/** One value of a person's record: words, or another record, shown by its name. */
export type RecordValue = { text: string } | { id: string };

/** A line of a person's record, with BDRC's own Tibetan label. */
export interface RecordRow {
  label: string;
  /** Under a label of their own (when, where) for events. */
  values: { label?: string; value: RecordValue }[];
}

/** A person's record on BDRC, as BDRC has it. */
export interface PersonRecord {
  /** Names and events. */
  life: RecordRow[];
  /** Family, teachers, tradition and so on. */
  relations: RecordRow[];
  links: { label: string; href: string }[];
  wikidataId: string | null;
}

export interface PersonImage {
  src: string;
  /** Its page on Wikimedia Commons, with the licence and who made it. */
  page: string;
}

/** A work on BDRC: a book, or a text inside one. */
export interface BdrcWork {
  id: string;
  title: string;
  /** The BDRC id of the book or collection it is in. */
  collectionId: string | null;
}

export interface WorkPage {
  total: number;
  works: BdrcWork[];
}
