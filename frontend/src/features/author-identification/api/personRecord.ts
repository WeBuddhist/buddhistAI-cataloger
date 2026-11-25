// A person's BDRC record, read live by id: the same record their page on library.bdrc.io shows.
import { msearch } from './bdrc';
import { BO, EVENT_LABELS, KNOWN_NAMES, NAME_LABELS, RELATIONS } from '../labels';
import { boDate, boLabel } from '../utils';
import type { PersonImage, PersonRecord, RecordRow, RecordValue } from '../types';

const LDS = 'https://ldspdi.bdrc.io';

interface Text {
  '@language'?: string;
  '@value': string;
}
interface Ref {
  '@id': string;
}
interface Node {
  '@id': string;
  '@type'?: string | string[];
  [property: string]: unknown;
}

const list = <T>(value: unknown): T[] => {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
};
const unique = (values: string[]) => [...new Set(values)];
/** "bdr:P264" as "P264". */
const idsOf = (refs: unknown) => unique(list<Ref>(refs).map((r) => r['@id'].replace(/^bdr:/, '')));
/** "SecretInitiatoryName" as "Secret Initiatory Name". */
const spaced = (words: string) => words.replace(/(?<=[a-z])(?=[A-Z])/g, ' ');
const typeOf = (node: Node) => list<string>(node['@type'])[0] ?? '';

const asText = (text: string): RecordValue => ({ text });
const asRecord = (id: string): RecordValue => ({ id });

const isTibetan = (text: Text) => text['@language'] === 'bo' || text['@language'] === 'bo-x-ewts';

function nameRows(nodes: Node[]): RecordRow[] {
  const names = new Map<string, string[]>();
  for (const node of nodes) {
    if (!/^bdr:NM/.test(node['@id'])) continue;
    const type = typeOf(node).replace(/^Person/, '');
    const texts = list<Text>(node['rdfs:label']).filter(isTibetan);
    names.set(type, [...(names.get(type) ?? []), ...texts.map((t) => boLabel(t['@value']))]);
  }
  // The primary ones first.
  const order = (type: string) => (type.startsWith('Primary') ? 0 : 1);
  return [...names]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([type, values]) => ({
      label: NAME_LABELS[type] ?? spaced(type),
      values: unique(values).map((v) => ({ value: asText(v) })),
    }));
}

function eventRows(nodes: Node[]): RecordRow[] {
  const year = (node: Node) => list<Text>(node.eventWhen)[0]?.['@value'] ?? '~';
  const order = (node: Node) => ({ PersonBirth: 0, PersonDeath: 2 })[typeOf(node)] ?? 1;
  return nodes
    .filter((n) => /^bdr:EV/.test(n['@id']))
    .sort((a, b) => order(a) - order(b) || year(a).localeCompare(year(b)))
    .map((node) => {
      const type = typeOf(node).replace(/^Person/, '');
      return {
        label: EVENT_LABELS[type] ?? spaced(type),
        values: [
          ...list<Text>(node.eventWhen).map((t) => ({ label: BO.when, value: asText(boDate(t['@value'])) })),
          ...idsOf(node.eventWhere).map((id) => ({ label: BO.where, value: asRecord(id) })),
          ...idsOf(node.role).map((id) => ({ label: BO.role, value: asRecord(id) })),
        ],
      };
    });
}

function relationRows(person: Node): RecordRow[] {
  return Object.values(RELATIONS).flatMap((group) => {
    const named = new Set<string>();
    return group.map(([property, label]) => {
      const ids = idsOf(person[property]).filter((id) => !named.has(id));
      ids.forEach((id) => named.add(id));
      return { label, values: ids.map((id) => ({ value: asRecord(id) })) };
    });
  });
}

const notEmpty = (row: RecordRow) => row.values.length > 0;

function linksOf(sameAs: string[]): PersonRecord['links'] {
  const links: PersonRecord['links'] = [];
  for (const id of sameAs) {
    const wikidata = /^wd:(Q\d+)$/.exec(id);
    const viaf = /^viaf:(\d+)$/.exec(id);
    const lives = /treasuryoflives\.org\/resource\/(\w+)$/.exec(id);
    if (lives) links.push({ label: 'Treasury of Lives', href: `https://api.treasuryoflives.org/resource/${lives[1]}` });
    if (wikidata) links.push({ label: 'Wikidata', href: `https://www.wikidata.org/wiki/${wikidata[1]}` });
    if (viaf) links.push({ label: 'VIAF', href: `https://viaf.org/viaf/${viaf[1]}` });
  }
  // Some have several records in one place.
  return links.filter((link, i) => links.findIndex((l) => l.label === link.label) === i);
}

export async function fetchPersonRecord(id: string, signal?: AbortSignal): Promise<PersonRecord> {
  const response = await fetch(`${LDS}/resource/${encodeURIComponent(id)}.jsonld`, { signal });
  if (!response.ok) throw new Error(`BDRC answered ${response.status}`);
  const nodes = ((await response.json()) as { '@graph'?: Node[] })['@graph'] ?? [];
  const person = nodes.find((n) => n['@id'] === `bdr:${id}`);
  if (!person) throw new Error('BDRC has no record of this person');

  const records = (property: string) => idsOf(person[property]).map((v) => ({ value: asRecord(v) }));
  const sameAs = list<Ref>(person['owl:sameAs']).map((r) => r['@id']);
  return {
    life: [...nameRows(nodes), ...eventRows(nodes)].filter(notEmpty),
    relations: [
      ...relationRows(person),
      { label: BO.tradition, values: records('associatedTradition') },
      { label: BO.gender, values: records('personGender') },
    ].filter(notEmpty),
    links: linksOf(sameAs),
    wikidataId: sameAs.map((s) => /^wd:(Q\d+)$/.exec(s)?.[1]).find((q) => q != null) ?? null,
  };
}

interface Labelled {
  prefLabel_bo_x_ewts?: string[];
  prefLabel_en?: string[];
}

/** Not in BDRC's search, but in its label service, which can be slow. */
export const isTerm = (id: string) => /^(R\d|Tradition|Gender)/.test(id);

/** Tibetan names of BDRC's persons, places and books by id; those without one are left out. */
export async function fetchNames(ids: string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const { hits } = await msearch<Labelled>(
    { size: ids.length, _source: ['prefLabel_bo_x_ewts', 'prefLabel_en'], query: { bool: { filter: [{ terms: { _id: ids } }] } } },
    signal,
  );
  const names: Record<string, string> = {};
  for (const { _id, _source } of hits) {
    const wylie = _source.prefLabel_bo_x_ewts?.[0];
    const name = wylie ? boLabel(wylie) : _source.prefLabel_en?.[0];
    if (name) names[_id] = name;
  }
  return names;
}

/** Tibetan names of roles, traditions and genders by id. */
export async function fetchTerms(ids: string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const asked: string[] = [];
  for (const id of ids) {
    if (KNOWN_NAMES[id]) names[id] = KNOWN_NAMES[id];
    else asked.push(id);
  }
  if (asked.length === 0) return names;
  const response = await fetch(`${LDS}/osquery_utils/getLabels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(asked),
    signal,
  });
  if (!response.ok) throw new Error(`BDRC answered ${response.status}`);
  const labels = (await response.json()) as Record<string, Record<string, string> | undefined>;
  for (const id of asked) {
    const label = labels[`bdr:${id}`];
    const wylie = label?.['bo-x-ewts'];
    if (wylie) names[id] = boLabel(wylie);
    else if (label?.en) names[id] = label.en;
  }
  return names;
}

/** For a term the label service did not answer about: "TraditionKarmaKagyu" as "Karma Kagyu". */
export const termFallback = (id: string) => spaced(id.replace(/^(Tradition|Gender)/, ''));

/** BDRC has no portraits, but links many people to Wikidata, which has some. */
export async function fetchPersonImage(wikidataId: string, signal?: AbortSignal): Promise<PersonImage | null> {
  const params = new URLSearchParams({ action: 'wbgetclaims', entity: wikidataId, property: 'P18', format: 'json', origin: '*' });
  const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { signal });
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
  const data = (await response.json()) as { claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] } };
  const file = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!file) return null;
  const name = encodeURIComponent(file);
  return {
    src: `https://commons.wikimedia.org/wiki/Special:FilePath/${name}?width=400`,
    page: `https://commons.wikimedia.org/wiki/File:${name}`,
  };
}
