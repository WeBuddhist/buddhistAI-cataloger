// Whole volumes, read straight from BDRC like the scans and the Outliner's volumes: the
// review API only serves the text itself.
import { fetchBdrcOtVolume } from '@/features/outliner/bdrc/api/volume';
import { searchVolume, type TextPlace, type Volume, type VolumePage } from '../textPlace';
import type { TextSource, WitnessCard } from './review';

const BASE = `${import.meta.env.VITE_BDRC_BACKEND_URL}/api/v1`;
const PAGE_SIZE = 200;
// Searching more OCR versions rarely helps and each one is a full volume download.
const MAX_VERSIONS_SEARCHED = 2;

export interface VolumeSummary {
  id: string;
  vol_id: string;
  volume_number: number;
  etext_source: string | null;
  status: string | null;
}

interface VolumeChunk {
  cstart: number;
  text_bo: string;
}

/** Every volume BDRC lists for a scanned work, in all its OCR versions. */
export async function fetchVolumes(repId: string, opts?: { signal?: AbortSignal }): Promise<VolumeSummary[]> {
  const all: VolumeSummary[] = [];
  for (;;) {
    const query = new URLSearchParams({ rep_id: repId, limit: String(PAGE_SIZE), offset: String(all.length) });
    const res = await fetch(`${BASE}/volumes?${query}`, { signal: opts?.signal });
    if (!res.ok) throw new Error(`BDRC volumes: ${res.status}`);
    const data = (await res.json()) as { total: number; items: VolumeSummary[] };
    all.push(...data.items);
    if (data.items.length === 0 || all.length >= data.total) return all;
  }
}

/** The volume's pages and full text, joined from its chunks. */
export async function fetchVolume(id: string, opts?: { signal?: AbortSignal }): Promise<Volume> {
  const volume = await fetchBdrcOtVolume(id, { signal: opts?.signal });
  const chunks = (volume.chunks ?? []) as VolumeChunk[];
  return {
    text: [...chunks].sort((a, b) => a.cstart - b.cstart).map((c) => c.text_bo).join(''),
    pages: (volume.pages ?? []) as VolumePage[],
  };
}

/**
 * Where the text sits in a volume. BDRC's position when its volume opens; otherwise
 * (`_BDCR_Outline` sources, which `/volumes` does not serve, or no position at all) by
 * searching the OCR versions it does list. Their character counts differ, so BDRC's
 * position is only a last resort on them.
 */
export async function locateText(
  card: WitnessCard,
  source: TextSource | undefined,
  text: string,
  getVolume: (id: string) => Promise<Volume>,
  opts?: { signal?: AbortSignal },
): Promise<TextPlace | null> {
  const { source_volume_id: id, source_cstart: cstart, source_cend: cend } = source ?? {};
  if (id && cstart != null) {
    try {
      const { pages } = await getVolume(id);
      return { pages, start: cstart, span: cend != null ? cend - cstart : null, exact: true };
    } catch {
      // Not served by /volumes: fall through to searching.
    }
  }
  if (!card.rep_id) return null;
  const textVolume = card.volume_id ?? '';
  const versions = (await fetchVolumes(card.rep_id, opts))
    .filter((v) => textVolume.includes(v.vol_id))
    .sort((a, b) => versionRank(a, card) - versionRank(b, card))
    .slice(0, MAX_VERSIONS_SEARCHED);
  let nearest: TextPlace | null = null;
  for (const version of versions) {
    const volume = await getVolume(version.id);
    const place = searchVolume(volume, text);
    if (place) return place;
    // OCR too poor to search. BDRC's position still lands near the text in a volume of the
    // same book, which beats the first page.
    if (cstart != null) nearest ??= { pages: volume.pages, start: cstart, span: cend != null ? cend - cstart : null, exact: false };
  }
  return nearest;
}

// BDRC can hold several OCR versions of one volume: the text's own version when there is
// one, then the same OCR as the text, then a reviewed one.
function versionRank(v: VolumeSummary, card: WitnessCard): number {
  if (v.id === card.volume_id) return 0;
  if (v.etext_source === card.etext_source) return 1;
  return v.status === 'reviewed' ? 2 : 3;
}

/** One version of each volume, in volume order. */
export function volumesInOrder(volumes: VolumeSummary[], card: WitnessCard): VolumeSummary[] {
  const best = new Map<string, VolumeSummary>();
  for (const v of volumes) {
    const held = best.get(v.vol_id);
    if (!held || versionRank(v, card) < versionRank(held, card)) best.set(v.vol_id, v);
  }
  return [...best.values()].sort((a, b) => a.volume_number - b.volume_number);
}

/** The volume the text is in: its `volume_id` carries the volume's id, whatever the OCR. */
export function volumeOfText(volumes: VolumeSummary[], card: WitnessCard): VolumeSummary | undefined {
  const textVolume = card.volume_id ?? '';
  return volumes
    .filter((v) => textVolume.includes(v.vol_id))
    .sort((a, b) => b.vol_id.length - a.vol_id.length)[0];
}
