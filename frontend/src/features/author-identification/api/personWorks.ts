// What BDRC has by a person, in the order their BDRC page has it.
import { msearch } from './bdrc';
import { boLabel } from '../utils';
import type { BdrcWork, WorkPage } from '../types';

const FIRST_PAGE = 5;
const NEXT_PAGES = 20;

interface Source {
  prefLabel_bo_x_ewts?: string[];
  prefLabel_en?: string[];
  inRootInstance?: string[];
}

export async function fetchPersonWorks(personId: string, from: number, signal?: AbortSignal): Promise<WorkPage> {
  const { total, hits } = await msearch<Source>(
    {
      from,
      size: from === 0 ? FIRST_PAGE : NEXT_PAGES,
      track_total_hits: true,
      _source: ['prefLabel_bo_x_ewts', 'prefLabel_en', 'inRootInstance'],
      query: {
        function_score: {
          script_score: { script: { id: 'bdrc-score' } },
          query: { bool: { filter: [{ term: { author: personId } }] } },
        },
      },
    },
    signal,
  );
  const works = hits.map(({ _id, _source }): BdrcWork => {
    const wylie = _source.prefLabel_bo_x_ewts?.[0];
    return {
      id: _id,
      title: wylie ? boLabel(wylie) : (_source.prefLabel_en?.[0] ?? _id),
      collectionId: _source.inRootInstance?.[0] ?? null,
    };
  });
  return { total: total.value, works };
}
