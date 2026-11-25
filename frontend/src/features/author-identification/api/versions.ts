// What BDRC's own records say about a text's versions, read live from its search.
import { msearch } from './bdrc';
import { boDate, trimLabel, wylieToTibetan } from '../utils';
import type { TextVersion, VersionDetails } from '../types';

interface Source {
  authorName_bo_x_ewts?: string[];
  printMethod?: string[];
  publicationDate?: string;
  publisherName_bo_x_ewts?: string[];
  publisherName_en?: string[];
  publisherLocation_bo_x_ewts?: string[];
  publisherLocation_en?: string[];
  extent?: string;
  script?: string[];
}

const FIELDS = [
  'authorName_bo_x_ewts',
  'printMethod',
  'publicationDate',
  'publisherName_bo_x_ewts',
  'publisherName_en',
  'publisherLocation_bo_x_ewts',
  'publisherLocation_en',
  'extent',
  'script',
];

const PRINTED: Record<string, string> = {
  // BDRC has no Tibetan word for it.
  PrintMethod_Modern: 'Modern',
  PrintMethod_Relief_WoodBlock: 'ཤིང་པར།',
  PrintMethod_Manuscript: 'བྲིས་མ།',
};

const SCRIPT: Record<string, string> = { ScriptDbuCan: 'དབུ་ཅན།', ScriptDbuMed: 'དབུ་མེད།' };

// BDRC puts "*" before some places and publishers, and shows it. The converter would make it a Tibetan mark.
const bo = (wylie?: string[]) => wylie?.[0]?.replace(/^(\*?)(.*)$/s, (_, star: string, name: string) => star + wylieToTibetan(name)) ?? null;
const en = (text?: string[]) => (text?.[0] ? trimLabel(text[0]) : null);

/** As BDRC writes it ("70 v."); page counts of every text in a volume are left out. */
function sizeOf(extent?: string): string | null {
  const size = extent?.trim();
  return size && size.length <= 20 ? size : null;
}

function detailsOf(own: Source | undefined, collection: Source | undefined): VersionDetails {
  // Print details are mostly on the collection's record. Its author is not used: a
  // collection by one person can hold texts by others.
  const all = { ...collection, ...own };
  const publisher = bo(all.publisherName_bo_x_ewts) ?? en(all.publisherName_en);
  const place = bo(all.publisherLocation_bo_x_ewts) ?? en(all.publisherLocation_en);
  return {
    author: bo(own?.authorName_bo_x_ewts),
    printed: PRINTED[all.printMethod?.[0] ?? ''] ?? null,
    date: all.publicationDate ? boDate(all.publicationDate) : null,
    publisher: [publisher, place].filter(Boolean).join(', ') || null,
    size: sizeOf(all.extent),
    script: SCRIPT[all.script?.[0] ?? ''] ?? null,
  };
}

/** Details of each version that is on BDRC, by version id. */
export async function fetchVersionDetails(
  versions: TextVersion[],
  signal?: AbortSignal,
): Promise<Record<string, VersionDetails>> {
  const ids = [...new Set(versions.flatMap((v) => [v.bdrcId, v.collection?.bdrcId]).filter((id) => id != null))];
  if (ids.length === 0) return {};
  const { hits } = await msearch<Source>(
    { size: ids.length, _source: FIELDS, query: { bool: { filter: [{ terms: { _id: ids } }] } } },
    signal,
  );
  const records = new Map(hits.map((h) => [h._id, h._source]));
  const details: Record<string, VersionDetails> = {};
  for (const v of versions) {
    const own = v.bdrcId ? records.get(v.bdrcId) : undefined;
    const collection = v.collection ? records.get(v.collection.bdrcId) : undefined;
    if (own || collection) details[v.id] = detailsOf(own, collection);
  }
  return details;
}
