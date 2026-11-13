import { useCallback, useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  claimItems,
  correctPair,
  fetchAdjudicationItem,
  fetchAdjudicationQueue,
  fetchAdminAdjudications,
  fetchAdminOverview,
  fetchAdminPair,
  fetchAdminPairNotes,
  fetchAdminPairs,
  fetchAnnotatorItems,
  fetchAnnotators,
  fetchBatches,
  fetchDiff,
  fetchText,
  fetchItem,
  fetchMyItems,
  fetchPair,
  fetchSettings,
  reassignAdjudications,
  reassignItems,
  saveAdjudication,
  saveDecision,
  updateSettings,
  type AdjudicationInput,
  type AdjudicationItem,
  type CorrectionInput,
  type DecisionInput,
  type DiffGranularity,
  type MyItemsState,
  type PairFilters,
  type PeriodRange,
  type ReviewItem,
  type ReviewMode,
} from '../api/review';
import { fetchOutlinePlace, fetchScanList } from '../api/scans';
import { batchNames } from '../utils';

/** Root key for every review query; use with invalidateQueries. */
export const reviewQueryKeyRoot = ['dedup-review'] as const;

const keys = {
  batches: [...reviewQueryKeyRoot, 'batches'] as const,
  myItemsRoot: [...reviewQueryKeyRoot, 'my-items'] as const,
  myItems: (state: MyItemsState, batchId?: string) =>
    [...reviewQueryKeyRoot, 'my-items', state, batchId ?? 'all-batches'] as const,
  item: (itemId: number) => [...reviewQueryKeyRoot, 'item', itemId] as const,
  pair: (itemId: number) => [...reviewQueryKeyRoot, 'pair', itemId] as const,
  adjudicationRoot: [...reviewQueryKeyRoot, 'adjudication'] as const,
  adjudicationQueue: (state: MyItemsState) => [...reviewQueryKeyRoot, 'adjudication', 'queue', state] as const,
  adjudicationItem: (itemId: number) => [...reviewQueryKeyRoot, 'adjudication', 'item', itemId] as const,
  text: (mwId: string) => [...reviewQueryKeyRoot, 'text', mwId] as const,
  diff: (a: string, b: string, g: DiffGranularity) => [...reviewQueryKeyRoot, 'diff', a, b, g] as const,
  scanPages: (imageGroup: string) => [...reviewQueryKeyRoot, 'scan-pages', imageGroup] as const,
  outlinePlace: (mwId: string) => [...reviewQueryKeyRoot, 'outline-place', mwId] as const,
  adminRoot: [...reviewQueryKeyRoot, 'admin'] as const,
  adminOverview: (period: PeriodRange) =>
    [...reviewQueryKeyRoot, 'admin', 'overview', period.since ?? '', period.until ?? ''] as const,
  annotators: (period: PeriodRange) =>
    [...reviewQueryKeyRoot, 'admin', 'annotators', period.since ?? '', period.until ?? ''] as const,
  annotatorItems: (userId: string, state: MyItemsState, period: PeriodRange) =>
    [...reviewQueryKeyRoot, 'admin', 'items', userId, state, period.since ?? '', period.until ?? ''] as const,
  adminAdjudications: (state: MyItemsState) => [...reviewQueryKeyRoot, 'admin', 'adjudications', state] as const,
  adminPair: (itemId: number) => [...reviewQueryKeyRoot, 'admin', 'pair', itemId] as const,
  adminPairs: (filters: PairFilters) => [...reviewQueryKeyRoot, 'admin', 'pairs', filters] as const,
  adminPairNotes: (itemId: number) => [...reviewQueryKeyRoot, 'admin', 'pair-notes', itemId] as const,
  settings: [...reviewQueryKeyRoot, 'admin', 'settings'] as const,
};

export function useBatches() {
  return useQuery({
    queryKey: keys.batches,
    queryFn: ({ signal }) => fetchBatches({ signal }),
  });
}

/** The batch row from the batch list (there is no single-batch endpoint). */
export function useBatch(batchId: string | undefined) {
  const batches = useBatches();
  return { ...batches, data: batches.data?.find((b) => b.batch_id === batchId) };
}

/** `batch_id` -> "First batch", "Second batch", … by the order batches were added.
 * Falls back to the raw id until the batch list has loaded. */
export function useBatchName() {
  const { data } = useBatches();
  const names = useMemo(() => batchNames(data ?? []), [data]);
  return useCallback((batchId: string) => names[batchId] ?? batchId, [names]);
}

/** This user's items, oldest first; all batches unless one is given. */
export function useMyItems(state: MyItemsState = 'all', batchId?: string, enabled = true) {
  return useQuery({
    queryKey: keys.myItems(state, batchId),
    queryFn: ({ signal }) => fetchMyItems(state, batchId, { signal }),
    enabled,
    // An admin may move items at any time: reload on every visit and tab focus.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** Returns the user's unfinished items instead while there still are some. */
export function useClaimItems(batchId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => claimItems(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.myItemsRoot });
      queryClient.invalidateQueries({ queryKey: keys.batches });
    },
  });
}

/**
 * Shown straight from the my-items list. The item endpoint is only called for a deep
 * link, or on the first opening, which the backend records as `first_opened_at`.
 */
export function useItem(itemId: number | undefined) {
  const queryClient = useQueryClient();
  const valid = itemId != null && !Number.isNaN(itemId);
  const fromList = valid
    ? queryClient
        .getQueriesData<ReviewItem[]>({ queryKey: keys.myItemsRoot })
        .flatMap(([, data]) => data ?? [])
        .find((it) => it.item_id === itemId)
    : undefined;
  const alreadyOpened = Boolean(fromList?.assignment?.first_opened_at);
  return useQuery({
    queryKey: keys.item(itemId ?? 0),
    queryFn: async ({ signal }) => {
      const opened = await fetchItem(itemId!, { signal });
      // Only the opening time is copied, so the list shows "In progress" right away.
      queryClient.setQueriesData<ReviewItem[]>({ queryKey: keys.myItemsRoot }, (data) =>
        data?.map((it) =>
          it.item_id === opened.item_id && it.assignment && opened.assignment
            ? { ...it, assignment: { ...it.assignment, first_opened_at: opened.assignment.first_opened_at } }
            : it,
        ),
      );
      return opened;
    },
    enabled: valid && !alreadyOpened,
    // Not this user's pair: the page switches to the read-only view at once.
    retry: false,
    // Shown at once while the first opening is recorded. Unlike initialData it is not
    // cached, so it cannot stop that request from being sent.
    placeholderData: fromList,
    // After that the item stays cached (saves update it in place).
    staleTime: Infinity,
  });
}

/** The response is the updated item, so it replaces the cached copies directly. */
export function useSaveDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, fields }: { itemId: number; fields: DecisionInput }) =>
      saveDecision(itemId, fields),
    onSuccess: (updated: ReviewItem) => {
      queryClient.setQueryData(keys.item(updated.item_id), updated);
      queryClient.setQueriesData<ReviewItem[]>({ queryKey: keys.myItemsRoot }, (data) =>
        data?.map((it) => (it.item_id === updated.item_id ? updated : it)),
      );
      queryClient.invalidateQueries({ queryKey: keys.myItemsRoot });
      queryClient.invalidateQueries({ queryKey: keys.batches });
    },
  });
}

/** The read-only shared page of a pair. */
export function usePair(itemId: number | undefined) {
  const valid = itemId != null && !Number.isNaN(itemId);
  return useQuery({
    queryKey: keys.pair(itemId ?? 0),
    queryFn: ({ signal }) => fetchPair(itemId!, { signal }),
    enabled: valid,
    staleTime: Infinity,
    retry: false,
  });
}

// Adjudication

/** Disputed pairs this person may settle (`open`), has settled (`done`), or both. */
export function useAdjudicationQueue(state: MyItemsState = 'open', enabled = true) {
  return useQuery({
    queryKey: keys.adjudicationQueue(state),
    queryFn: ({ signal }) => fetchAdjudicationQueue(state, { signal }),
    enabled,
    // Pairs arrive whenever two annotators disagree: reload on every visit and tab focus.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** Opening a pair takes it for this adjudicator, so it is always fetched; the queue's
 * copy is shown meanwhile. */
export function useAdjudicationItem(itemId: number | undefined) {
  const queryClient = useQueryClient();
  const valid = itemId != null && !Number.isNaN(itemId);
  const fromList = valid
    ? queryClient
        .getQueriesData<AdjudicationItem[]>({ queryKey: keys.adjudicationRoot })
        .flatMap(([, data]) => (Array.isArray(data) ? data : []))
        .find((it) => it.item_id === itemId)
    : undefined;
  return useQuery({
    queryKey: keys.adjudicationItem(itemId ?? 0),
    queryFn: ({ signal }) => fetchAdjudicationItem(itemId!, { signal }),
    enabled: valid,
    placeholderData: fromList,
    staleTime: Infinity,
    retry: false,
  });
}

export function useSaveAdjudication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, fields }: { itemId: number; fields: AdjudicationInput }) =>
      saveAdjudication(itemId, fields),
    onSuccess: (updated: AdjudicationItem) => {
      queryClient.setQueryData(keys.adjudicationItem(updated.item_id), updated);
      queryClient.invalidateQueries({ queryKey: keys.adjudicationRoot, exact: false, refetchType: 'active' });
    },
  });
}

/** Only fetched when `enabled`. */
export function useFullText(mwId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.text(mwId ?? ''),
    queryFn: ({ signal }) => fetchText(mwId!, { signal }),
    enabled: Boolean(mwId) && enabled,
    staleTime: Infinity,
  });
}

/**
 * BDRC's page list for one image group (a scanned volume). iiifpres answers 404 now and then
 * when busy, and a second later serves the same list, hence the retries.
 */
export function useScanList(imageGroup: string | null) {
  return useQuery({
    queryKey: keys.scanPages(imageGroup ?? ''),
    queryFn: ({ signal }) => fetchScanList(imageGroup!, { signal }),
    enabled: Boolean(imageGroup),
    staleTime: Infinity,
    retry: 3,
  });
}

/** BDRC's catalogue page range for a text from one of its outlines; null for other texts. */
export function useOutlinePlace(mwId: string, enabled = true) {
  return useQuery({
    queryKey: keys.outlinePlace(mwId),
    queryFn: ({ signal }) => fetchOutlinePlace(mwId, { signal }),
    enabled,
    staleTime: Infinity,
    retry: 2,
  });
}

/** Only fetched when `enabled`. */
export function useTextDiff(a: string | undefined, b: string | undefined, granularity: DiffGranularity, enabled = true) {
  return useQuery({
    queryKey: keys.diff(a ?? '', b ?? '', granularity),
    queryFn: ({ signal }) => fetchDiff(a!, b!, granularity, { signal }),
    enabled: Boolean(a && b) && enabled,
    staleTime: Infinity,
  });
}

// Admin

export function useAdminOverview(period: PeriodRange = {}) {
  return useQuery({
    queryKey: keys.adminOverview(period),
    queryFn: ({ signal }) => fetchAdminOverview(period, { signal }),
    staleTime: 0,
  });
}

export function useAnnotators(period: PeriodRange = {}) {
  return useQuery({
    queryKey: keys.annotators(period),
    queryFn: ({ signal }) => fetchAnnotators(period, { signal }),
    staleTime: 0,
  });
}

export function useAnnotatorItems(userId: string | undefined, state: MyItemsState, period: PeriodRange = {}) {
  return useQuery({
    queryKey: keys.annotatorItems(userId ?? '', state, period),
    queryFn: ({ signal }) => fetchAnnotatorItems(userId!, state, period, { signal }),
    enabled: Boolean(userId),
    staleTime: 0,
  });
}

export function useReassign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemIds, toUserId, fromUserId }: { itemIds: number[]; toUserId: string | null; fromUserId?: string }) =>
      reassignItems(itemIds, toUserId, fromUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.adminRoot });
      queryClient.invalidateQueries({ queryKey: keys.myItemsRoot });
    },
  });
}

export function useAdminAdjudications(state: MyItemsState) {
  return useQuery({
    queryKey: keys.adminAdjudications(state),
    queryFn: ({ signal }) => fetchAdminAdjudications(state, { signal }),
    staleTime: 0,
  });
}

export function useReassignAdjudications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemIds, toUserId }: { itemIds: number[]; toUserId: string | null }) =>
      reassignAdjudications(itemIds, toUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.adminRoot });
      queryClient.invalidateQueries({ queryKey: keys.adjudicationRoot });
    },
  });
}

/** Deduplicator-wide settings (admins only). */
export function useDedupSettings(enabled = true) {
  return useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => fetchSettings({ signal }),
    enabled,
    staleTime: 0,
  });
}

export function useUpdateReviewMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: ReviewMode) => updateSettings(mode),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.settings, updated);
      queryClient.invalidateQueries({ queryKey: keys.adminRoot });
    },
  });
}

/** A pair with its final answer and answer history, for the admin correction page. */
export function useAdminPair(itemId: number | undefined) {
  const valid = itemId != null && !Number.isNaN(itemId);
  return useQuery({
    queryKey: keys.adminPair(itemId ?? 0),
    queryFn: ({ signal }) => fetchAdminPair(itemId!, { signal }),
    enabled: valid,
    staleTime: 0,
    retry: false,
  });
}

export function useCorrectPair() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, fields }: { itemId: number; fields: CorrectionInput }) => correctPair(itemId, fields),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.adminPair(updated.item_id), updated);
      queryClient.invalidateQueries({ queryKey: keys.adminRoot });
      // The annotator's and adjudicator's copies are now locked.
      queryClient.invalidateQueries({ queryKey: keys.myItemsRoot });
      queryClient.invalidateQueries({ queryKey: keys.item(updated.item_id) });
      queryClient.invalidateQueries({ queryKey: keys.adjudicationRoot });
    },
  });
}

/** Every handed-out pair with its final answer, filtered and paged (admin pair list). */
// Fetched when the notes popup on the admin pair list opens.
export function useAdminPairNotes(itemId: number | undefined) {
  return useQuery({
    queryKey: keys.adminPairNotes(itemId ?? 0),
    queryFn: ({ signal }) => fetchAdminPairNotes(itemId!, { signal }),
    enabled: itemId != null,
    staleTime: 0,
  });
}

export function useAdminPairs(filters: PairFilters) {
  return useQuery({
    queryKey: keys.adminPairs(filters),
    queryFn: ({ signal }) => fetchAdminPairs(filters, { signal }),
    // Keeps the current page on screen while the next filter or page loads.
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}
