// Scanned pages, read straight from BDRC (not through the review API): the page list
// from iiifpres and the images from IIIF. Restricted pages go through the backend's
// image proxy, which holds the BDRC key.

import type { WitnessCard } from './review';

export interface ScanPage {
  filename: string;
  width: number;
  height: number;
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
 */
export async function fetchScanPages(imageGroup: string, opts?: { signal?: AbortSignal }): Promise<ScanPage[]> {
  const id = encodeURIComponent(imageGroup);
  const [res, intro] = await Promise.all([
    fetch(`https://iiifpres.bdrc.io/il/v:bdr:${id}`, { signal: opts?.signal }),
    fetchIntroPages(id, opts?.signal),
  ]);
  if (!res.ok) throw new Error(`BDRC page list: ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('BDRC page list: unexpected response');
  const pages = data.filter(
    (p): p is ScanPage => typeof p?.filename === 'string' && p.width > 0 && p.height > 0,
  );
  return intro < pages.length ? pages.slice(intro) : pages;
}

/** BDRC's intro page count for an image group; 0 when it cannot be read. */
async function fetchIntroPages(id: string, signal?: AbortSignal): Promise<number> {
  try {
    const res = await fetch(`https://purl.bdrc.io/resource/${id}.jsonld`, {
      signal,
      headers: { Accept: 'application/ld+json' },
    });
    if (!res.ok) return 0;
    const raw = JSON.stringify(await res.json());
    // The value sits in the JSON-LD graph as {"@value": "2", ...}; its exact nesting varies.
    const m =
      /"volumePagesTbrcIntro"\s*:\s*\{[^}]*"@value"\s*:\s*"?(\d+)/.exec(raw) ?? /"volumePagesTbrcIntro"\s*:\s*"?(\d+)/.exec(raw);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** IIIF image of one page at full size, so it stays sharp when zoomed. */
export function pageImageUrl(imageGroup: string, page: ScanPage): string {
  return `https://iiif.bdrc.io/bdr:${imageGroup}::${page.filename}/full/max/0/default.jpg`;
}
