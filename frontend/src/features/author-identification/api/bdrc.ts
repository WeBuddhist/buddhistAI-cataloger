// BDRC's own search, the one library.bdrc.io uses. The login is the public read-only one that
// library.bdrc.io sends from every browser.
const SEARCH_URL = import.meta.env.VITE_BDRC_SEARCH_URL || 'https://autocomplete.bdrc.io/msearch';
const SEARCH_AUTH = import.meta.env.VITE_BDRC_SEARCH_AUTH || 'cHVibGljcXVlcnk6MFZzZzFRdmpMa1RDenZ0bA==';
const INDEX = 'bdrc_prod';

export interface Hit<S> {
  _id: string;
  _source: S;
  highlight?: Record<string, string[] | undefined>;
}

interface Hits<S> {
  total: { value: number };
  hits: Hit<S>[];
}

/** One query per request: BDRC answers every query of a request with the first one's results. */
export async function msearch<S>(query: object, signal?: AbortSignal): Promise<Hits<S>> {
  const response = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${SEARCH_AUTH}` },
    body: `${JSON.stringify({ index: INDEX })}\n${JSON.stringify(query)}\n`,
    signal,
  });
  if (!response.ok) throw new Error(`BDRC search answered ${response.status}`);
  const data = (await response.json()) as { responses?: { hits?: Hits<S> }[] };
  const hits = data.responses?.[0]?.hits;
  // A failed search must not read as "nobody found".
  if (!hits) throw new Error('BDRC search returned an unexpected answer');
  return hits;
}
