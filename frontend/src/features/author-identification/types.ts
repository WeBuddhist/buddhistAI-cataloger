/** One copy of a text. `bdrcId` is null when the copy has no page of its own on BDRC. */
export interface TextVersion {
  id: string;
  bdrcId: string | null;
  /** Null when the copy is not in any BDRC collection (e.g. a local upload). */
  collection: { name: string; bdrcId: string } | null;
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

/** The model's guess. `evidence` is quoted from the text, so it can be marked there. */
export interface AuthorPrediction {
  name: string;
  /** 0 to 1. */
  confidence: number | null;
  evidence: string | null;
}

/** One deduplicated text to find the author of. */
export interface AuthorTask {
  id: string;
  title: string;
  content: string;
  versions: TextVersion[];
  prediction: AuthorPrediction | null;
}

export interface BdrcPerson {
  id: string;
  nameBo: string;
  nameWylie: string;
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

export type AuthorAnswer =
  | { kind: 'person'; personId: string; name: string }
  | { kind: 'not_in_bdrc'; name: string; note: string }
  | { kind: 'unknown'; note: string };

export type SavedAnswer = AuthorAnswer & { savedAt: string };

/** One of my texts, as listed. */
export interface TaskSummary {
  id: string;
  title: string;
  /** Null while it is to do. */
  answer: SavedAnswer | null;
}
