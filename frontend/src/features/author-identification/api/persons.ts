// Person search by name. BDRC matches the whole phrase only: asking it for "any of the words"
// or fuzzy spelling changes nothing, hence suggestNames below.
// To move to our backend later: keep the two exported functions and change what they call.
import { msearch, type Hit as BdrcHit } from './bdrc';
import { cleanName, nameParts, trimLabel, wylieToTibetan } from '../utils';
import type { BdrcPerson, NameSuggestion, PersonPage } from '../types';

export const PAGE_SIZE = 10;

interface Source {
  prefLabel_bo_x_ewts?: string[];
  prefLabel_en?: string[];
  birthDate?: string;
  deathDate?: string;
  associatedCentury?: number[];
}

type Hit = BdrcHit<Source>;

function personQuery(name: string, from: number, size: number) {
  return {
    from,
    size,
    highlight: {
      fields: { prefLabel_bo_x_ewts: {}, altLabel_bo_x_ewts: { fragment_size: 500 } },
    },
    query: {
      function_score: {
        script_score: { script: { id: 'bdrc-score' } },
        query: {
          bool: {
            filter: [{ term: { type: 'Person' } }],
            must: [
              {
                multi_match: {
                  type: 'phrase',
                  query: name,
                  fields: ['prefLabel_bo_x_ewts^1', 'prefLabel_en^1', 'altLabel_bo_x_ewts^0.6', 'altLabel_en^0.6'],
                },
              },
            ],
          },
        },
      },
    },
  };
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function datesOf({ birthDate, deathDate, associatedCentury }: Hit['_source']): string | null {
  if (birthDate || deathDate) return `${birthDate ?? '?'} – ${deathDate ?? '?'}`;
  if (associatedCentury?.length) return `${associatedCentury.map(ordinal).join(', ')} century`;
  return null;
}

function toPerson(hit: Hit): BdrcPerson {
  const wylie = trimLabel(hit._source.prefLabel_bo_x_ewts?.[0] ?? '');
  const other = hit._source.prefLabel_en?.[0] ?? hit._id;
  const alias = hit.highlight?.altLabel_bo_x_ewts?.[0]?.replace(/<\/?em>/g, '');
  const nameMatched = Boolean(hit.highlight?.prefLabel_bo_x_ewts?.length);
  return {
    id: hit._id,
    nameBo: wylie ? wylieToTibetan(wylie) : other,
    nameWylie: wylie,
    matchedName: alias && !nameMatched ? wylieToTibetan(alias) : null,
    dates: datesOf(hit._source),
  };
}

export async function searchPersons(name: string, from: number, signal?: AbortSignal): Promise<PersonPage> {
  const hits = await msearch<Source>(personQuery(cleanName(name), from, PAGE_SIZE), signal);
  return { total: hits.total.value, persons: hits.hits.map(toPerson) };
}

// Few at a time, to go easy on BDRC.
const PARTS_AT_ONCE = 4;

/** For a name that found nobody: shorter forms of it that do, longest first. */
export async function suggestNames(name: string, signal?: AbortSignal): Promise<NameSuggestion[]> {
  const parts = nameParts(cleanName(name));
  for (let i = 0; i < parts.length; i += PARTS_AT_ONCE) {
    const found = await Promise.all(
      parts.slice(i, i + PARTS_AT_ONCE).map(async (part) => ({
        name: part,
        total: (await msearch<Source>(personQuery(part, 0, 1), signal)).total.value,
      })),
    );
    const some = found.filter((s) => s.total > 0);
    if (some.length > 0) return some;
  }
  return [];
}
