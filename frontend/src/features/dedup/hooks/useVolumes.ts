import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPairSources, type WitnessCard } from '../api/review';
import { fetchVolume, fetchVolumes, locateText } from '../api/volumes';
import { useFullText } from './useReview';

const volumeKey = (id: string | undefined) => ['dedup', 'volume', id];

export function useVolumeList(repId: string | null | undefined) {
  return useQuery({
    queryKey: ['dedup', 'volumes', repId],
    queryFn: ({ signal }) => fetchVolumes(repId!, { signal }),
    enabled: Boolean(repId),
    staleTime: Infinity,
  });
}

export function useVolume(id: string | undefined) {
  return useQuery({
    queryKey: volumeKey(id),
    queryFn: ({ signal }) => fetchVolume(id!, { signal }),
    enabled: Boolean(id),
    staleTime: Infinity,
  });
}

/** Where a text sits in a volume; null data when it could not be found. */
export function useTextPlace(itemId: number | undefined, side: 'a' | 'b', card: WitnessCard, enabled = true) {
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: ['dedup', 'pair-sources', itemId],
    queryFn: ({ signal }) => fetchPairSources(itemId!, { signal }),
    enabled: enabled && itemId != null,
    staleTime: Infinity,
    retry: false,
  });
  const text = useFullText(card.mw_id, enabled);
  const fullText = text.data?.text_bo;
  const sourcesSettled = itemId == null || sources.isFetched;
  return useQuery({
    queryKey: ['dedup', 'text-place', card.mw_id],
    queryFn: ({ signal }) =>
      locateText(
        card,
        sources.data?.[side],
        fullText ?? '',
        (id) =>
          queryClient.fetchQuery({
            queryKey: volumeKey(id),
            queryFn: () => fetchVolume(id),
            staleTime: Infinity,
            retry: false,
          }),
        { signal },
      ),
    enabled: enabled && sourcesSettled && fullText != null,
    staleTime: Infinity,
    retry: false,
  });
}
