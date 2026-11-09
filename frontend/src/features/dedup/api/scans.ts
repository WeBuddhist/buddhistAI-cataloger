// Scanned pages, read straight from BDRC (not through the review API): the page list
// from iiifpres, the volume's details and the texts' page ranges from purl, and the
// images from IIIF. Restricted pages go through the backend's image proxy, which holds
// the BDRC key.

import type { WitnessCard } from './review';

export interface ScanPage {
  filename: string;
  width: number;
  height: number;
  /** BDRC's number for the page: its place in the volume's full image list, from 1. */
  num: number;
}

export interface ScanList {
  /** The volume's pages, from the first real page on (see `fetchScanList`). */
  pages: ScanPage[];
  /** Which volume of its work this is, when BDRC says. */
  volumeNumber: number | null;
}

/** `https://library.bdrc.io/view/bdr:I4PD3658` -> `I4PD3658`. */
export function imageGroupOf(imageUrl: string | null | undefined): string | null {
  const m = imageUrl ? /bdr:([A-Za-z0-9_-]+)/.exec(imageUrl) : null;
  return m ? m[1] : null;
}

/**
 * The image group of a text's scans. BDRC's `image_url` drops the end of some ids (NLM
 * volumes: `I1NLM3651` for `I1NLM3651_001`), and only the full one has scans; `volume_id`
 * carries it for those volumes.
 */
export function scanGroupOf(card: Pick<WitnessCard, 'image_url' | 'volume_id'>): string | null {
  const group = imageGroupOf(card.image_url);
  return group && card.volume_id?.startsWith(`${group}_`) ? card.volume_id : group;
}

/**
 * The volume's pages, without the scan-request / title sheets BDRC puts in front of every
 * scan (its `volumePagesTbrcIntro`, usually 2): the list starts at the first real page.
 * Each page keeps BDRC's own number, which is what its outlines give page ranges in.
 */
export async function fetchScanList(imageGroup: string, opts?: { signal?: AbortSignal }): Promise<ScanList> {
  const id = encodeURIComponent(imageGroup);
  const [res, info] = await Promise.all([
    fetch(`https://iiifpres.bdrc.io/il/v:bdr:${id}`, { signal: opts?.signal }),
    fetchGroupInfo(id, opts?.signal),
  ]);
  if (!res.ok) throw new Error(`BDRC page list: ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('BDRC page list: unexpected response');
  const pages = data
    .map((p, i) => ({ ...p, num: i + 1 }))
    .filter((p): p is ScanPage => typeof p?.filename === 'string' && p.width > 0 && p.height > 0);
  return {
    pages: info.intro < pages.length ? pages.slice(info.intro) : pages,
    volumeNumber: info.volumeNumber,
  };
}

/** BDRC's intro page count (0 when it cannot be read) and volume number for an image group. */
async function fetchGroupInfo(id: string, signal?: AbortSignal): Promise<{ intro: number; volumeNumber: number | null }> {
  const graph = await fetchJsonLd(id, signal);
  return {
    intro: numberIn(graph, 'volumePagesTbrcIntro') ?? 0,
    volumeNumber: numberIn(graph, 'volumeNumber'),
  };
}

/** Where an outline text sits in its work, as BDRC's catalogue records it. */
export interface OutlinePlace {
  volume: number;
  /** First page, in BDRC's page numbers (see `ScanPage.num`). */
  start: number;
  /** Last volume and page, when recorded. */
  endVolume: number | null;
  end: number | null;
  /**
   * For a `~N` text, its piece of the outline entry (an entry can hold several short texts).
   * The range is then the whole entry's, which only piece 1 starts with.
   */
  piece: number | null;
}

/**
 * The page range BDRC's catalogue gives a text that comes from one of its outlines
 * (`MW1NLM6986_O1NLM6986_022`). Null for any other text: purl has no such entry for them.
 */
export async function fetchOutlinePlace(mwId: string, opts?: { signal?: AbortSignal }): Promise<OutlinePlace | null> {
  const [entry, pieceTag] = mwId.split('~');
  const graph = await fetchJsonLd(encodeURIComponent(entry), opts?.signal);
  const location = findNode(graph, (node) => 'contentLocationPage' in node);
  if (!location) return null;
  const start = numberIn(location, 'contentLocationPage');
  if (start == null) return null;
  const piece = pieceTag ? Number(pieceTag) : null;
  return {
    volume: numberIn(location, 'contentLocationVolume') ?? 1,
    start,
    endVolume: numberIn(location, 'contentLocationEndVolume'),
    end: numberIn(location, 'contentLocationEndPage'),
    piece: piece != null && Number.isFinite(piece) ? piece : null,
  };
}

/** A purl resource's JSON-LD; null when it is missing or cannot be read. */
async function fetchJsonLd(id: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(`https://purl.bdrc.io/resource/${id}.jsonld`, {
      signal,
      headers: { Accept: 'application/ld+json' },
    });
    return res.ok ? await res.json() : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/** The first object anywhere in a JSON-LD document that `test` accepts. */
function findNode(value: unknown, test: (node: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findNode(v, test);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (test(node)) return node;
    for (const v of Object.values(node)) {
      const found = findNode(v, test);
      if (found) return found;
    }
  }
  return null;
}

/** A whole number stored under `key` anywhere in the document: `2`, `"2"` or `{"@value": "2"}`. */
function numberIn(value: unknown, key: string): number | null {
  const node = findNode(value, (n) => key in n);
  let raw = node?.[key];
  if (Array.isArray(raw)) raw = raw[0];
  if (raw && typeof raw === 'object') raw = (raw as Record<string, unknown>)['@value'];
  if (typeof raw === 'string') raw = Number(raw);
  return typeof raw === 'number' && Number.isInteger(raw) ? raw : null;
}

// Widths the list asks IIIF for: a few fixed steps, so a page is fetched once whatever the
// panel's exact size, and the browser cache serves it again.
const LIST_WIDTHS = [600, 900, 1200, 1600, 2000];

/** IIIF image of one page at full size, for zooming in. */
export function pageImageUrl(imageGroup: string, page: ScanPage): string {
  return `https://iiif.bdrc.io/bdr:${imageGroup}::${page.filename}/full/max/0/default.jpg`;
}

/**
 * IIIF image of one page for the list: about as wide as it is shown (`pixels` wide on
 * screen), never wider than the scan. A full-size page is several times heavier.
 */
export function pageListImageUrl(imageGroup: string, page: ScanPage, pixels: number): string {
  const width = LIST_WIDTHS.find((w) => w >= pixels) ?? LIST_WIDTHS.at(-1)!;
  if (width >= page.width) return pageImageUrl(imageGroup, page);
  return `https://iiif.bdrc.io/bdr:${imageGroup}::${page.filename}/full/${width},/0/default.jpg`;
}
