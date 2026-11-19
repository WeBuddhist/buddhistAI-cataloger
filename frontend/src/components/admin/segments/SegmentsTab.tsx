import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { EllipsisVertical, PanelRightClose, PanelRightOpen, Undo } from 'lucide-react';
import {
  List,
  useListRef,
  type RowComponentProps,
} from 'react-window';
import { useDocumentSegmentNav, useScrollRequest } from './DocumentSegmentNavContext';
import { useSegmentRowHeight } from './useSegmentRowHeight';
import type { Document, Segment } from '../shared/types';
import type { SanityCheckFinding } from '@/api/outliner';
import SegmentRow from './SegmentRow';
import AdminSanityCheckButton from './AdminSanityCheckButton';
import { useAdminSanityCheck } from './useAdminSanityCheck';
import { flashSegmentRange } from '@/components/outliner/utils/flashSegmentRange';
import { Button } from '@/components/ui/button';
import {
  approveOutlinerDocument,
  assignDocumentReviewer,
  resetSegments,
  updateDocumentAssignee,
  updateDocumentStatus,
} from '@/api/outliner';
import { searchUsers } from '@/api/user';
import { VolumeImagePanelCore } from '@/components/outliner/ImageWrapper';
import { useVolumeHasImages } from '@/features/outliner/bdrc/hook/useBdrcOtVolume';
import { useParams } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUser } from '@/hooks/useUser';

type SegmentStatusFilter = 'all' | 'unchecked' | 'checked' | 'approved' | 'rejected';
/** Normal per-document split limit (backend review_split_limit.py); a higher one means a long volume. */
const REVIEWER_SPLIT_LIMIT_DEFAULT = 2;

function AdminDocumentSegmentRow({
  index,
  style,
  segments,
  expandedSegments,
  onToggleExpansion,
  documentFilename,
  onSegmentBodyCaretChange,
  canEditReview,
  sanityFindingsBySegmentId,
  documentContent,
  nextSegmentById,
}: RowComponentProps<{
  segments: Segment[];
  expandedSegments: Set<string>;
  onToggleExpansion: (segmentId: string) => void;
  documentFilename?: string | null;
  onSegmentBodyCaretChange?: (segmentId: string, offset: number | null) => void;
  canEditReview: boolean;
  sanityFindingsBySegmentId: Map<string, SanityCheckFinding[]>;
  documentContent: string;
  nextSegmentById: Map<string, Segment>;
}>) {
  const segment = segments[index];
  if (!segment) return null;
  return (
    <div style={style} className="px-1 pb-3 box-border">
      <SegmentRow
        segment={segment}
        isExpanded={expandedSegments.has(segment.id)}
        onToggleExpansion={onToggleExpansion}
        documentFilename={documentFilename}
        listIndex={index + 1}
        onSegmentBodyCaretChange={onSegmentBodyCaretChange}
        canEditReview={canEditReview}
        sanityFindings={sanityFindingsBySegmentId.get(segment.id)}
        documentContent={documentContent}
        nextSegment={nextSegmentById.get(segment.id)}
      />
    </div>
  );
}

interface SegmentsTabProps {
  readonly selectedDocument: Document | null;
  readonly segments: Segment[];
  readonly loadingSegments: boolean;
  readonly expandedSegments: Set<string>;
  readonly onToggleExpansion: (segmentId: string) => void;
}

function SegmentsTab({
  selectedDocument,
  segments,
  loadingSegments,
  expandedSegments,
  onToggleExpansion,
}: SegmentsTabProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<SegmentStatusFilter>('all');
  const [imagesPanelVisible, setImagesPanelVisible] = useState(false);
  const hasImages = useVolumeHasImages(selectedDocument?.filename ?? null);
  const showImagePanel = imagesPanelVisible && hasImages;
  /** Image panel width in px once the reviewer drags the divider; 30% until then. */
  const [imagePanelWidth, setImagePanelWidth] = useState<number | null>(null);
  const imageLayoutRef = useRef<HTMLDivElement>(null);
  const startImagePanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const layout = imageLayoutRef.current;
    if (!layout) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
      const rect = layout.getBoundingClientRect();
      // Same limits as before: panel 200px to 50% wide, list at least 280px.
      const max = Math.min(rect.width / 2, rect.width - 280);
      setImagePanelWidth(Math.max(200, Math.min(rect.right - e.clientX, max)));
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, []);
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  /** After a successful Submit, keep the button disabled until this document is left and opened again. */
  const [submittedThisVisit, setSubmittedThisVisit] = useState(false);
  const { documentId } = useParams<{ documentId: string }>();
  const queryClient = useQueryClient();
  const { user: currentUser } = useUser();
  const { setActiveSegmentId, requestScrollToSegment } = useDocumentSegmentNav();
  const documentContent = selectedDocument?.content ?? '';
  // One shared result for the toolbar dialog and the per-segment alert icons.
  const sanityCheck = useAdminSanityCheck(documentId, segments);
  const scrollRequest = useScrollRequest();
  const listRef = useListRef(null);
  const handledScrollNonce = useRef<number | null>(null);
  const canEditReview =
    !!currentUser?.id && selectedDocument?.reviewer_id === currentUser.id;
  // Reviewer split limit (admins have none); shown while the document is under review.
  const splitLimit = selectedDocument?.reviewer_split_limit ?? null;
  const splitsUsed = selectedDocument?.reviewer_splits_used ?? 0;
  const showSplitLimit =
    canEditReview &&
    currentUser?.role !== 'admin' &&
    selectedDocument?.status === 'completed' &&
    splitLimit !== null;
  const splitLimitReached = showSplitLimit && splitsUsed >= (splitLimit ?? 0);

  useEffect(() => {
    setSubmittedThisVisit(false);
  }, [documentId]);
  const isAdminOrReviewer =
    currentUser?.role === 'admin' || currentUser?.role === 'reviewer';
  const canClaimReview =
    isAdminOrReviewer && !selectedDocument?.reviewer_id && !!documentId;
  const filteredSegments = useMemo(() => {
    if (statusFilter === 'all') return segments;
    return segments.filter(s => (s.status ?? 'unchecked') === statusFilter);
  }, [segments, statusFilter]);
  /** Next segment in document order (not the filtered list), for the reviewer's merge. */
  const nextSegmentById = useMemo(() => {
    const ordered = [...segments].sort((a, b) => a.segment_index - b.segment_index);
    const map = new Map<string, Segment>();
    for (let i = 0; i < ordered.length - 1; i++) map.set(ordered[i].id, ordered[i + 1]);
    return map;
  }, [segments]);
  const filteredSegmentIds = useMemo(() => filteredSegments.map((s) => s.id), [filteredSegments]);

  useEffect(() => {
    if (!scrollRequest || handledScrollNonce.current === scrollRequest.nonce) return;
    const index = filteredSegments.findIndex((s) => s.id === scrollRequest.segmentId);
    if (index < 0) {
      setStatusFilter('all');
      return;
    }
    handledScrollNonce.current = scrollRequest.nonce;
    const MAX_SETTLE_FRAMES = 30;
    let raf = 0;
    let lastTop = -1;
    let stableFrames = 0;
    let attempts = 0;
    const settle = () => {
      const api = listRef.current;
      if (!api) return;
      api.scrollToRow({ index, align: 'start' });
      const top = api.element?.scrollTop ?? 0;
      if (top === lastTop) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastTop = top;
      }
      attempts += 1;
      if (stableFrames < 3 && attempts < MAX_SETTLE_FRAMES) {
        raf = requestAnimationFrame(settle);
      }
    };
    raf = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(raf);
  }, [scrollRequest, filteredSegments, listRef]);

  /** Caret in segment body text (document coordinates via span_start + offset), for BDRC image sync. */
  const [segmentBodyCaret, setSegmentBodyCaret] = useState<{
    segmentId: string;
    offset: number;
  } | null>(null);

  const handleRowsRendered = useCallback(
    (visible: { startIndex: number }) => {
      setActiveSegmentId(filteredSegments[visible.startIndex]?.id ?? null);
    },
    [filteredSegments, setActiveSegmentId]
  );

  const handleSegmentBodyCaretChange = useCallback(
    (segmentId: string, offset: number | null) => {
      setSegmentBodyCaret((prev) => {
        if (offset === null) {
          if (prev?.segmentId === segmentId) return null;
          return prev;
        }
        return { segmentId, offset };
      });
    },
    []
  );

  // Heights are remembered per segment, so a split or merge doesn't throw the list off its place.
  const rowHeight = useSegmentRowHeight(filteredSegmentIds, () => listRef.current?.element);

  const statusCounts = useMemo(() => {
    const counts = { unchecked: 0, checked: 0, approved: 0, rejected: 0 };
    for (const s of segments) {
      const st = (s.status ?? 'unchecked') as keyof typeof counts;
      if (st in counts) counts[st]++;
    }
    return counts;
  }, [segments]);

  /**
   * Document-level index for BDRC page sync (same idea as outliner VolumeImagePanel:
   * span_start + caret offset in segment body when the user has focus there).
   */
  const documentCharIndexForImage = useMemo((): number | null => {
    if (segmentBodyCaret) {
      const s = filteredSegments.find((seg) => seg.id === segmentBodyCaret.segmentId);
      if (
        s &&
        expandedSegments.has(s.id) &&
        typeof s.span_start === 'number'
      ) {
        return s.span_start + Math.max(0, segmentBodyCaret.offset);
      }
    }
    for (const s of filteredSegments) {
      if (expandedSegments.has(s.id) && typeof s.span_start === 'number') {
        return s.span_start;
      }
    }
    return null;
  }, [filteredSegments, expandedSegments, segmentBodyCaret]);

  const approveDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error('Document ID is required');
      return approveOutlinerDocument(documentId);
    },
    onSuccess: async () => {
      setSubmittedThisVisit(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] }),
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-documents'] }),
      ]);
      toast.success('Document approved successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to approve document');
    },
  });

  const handleApproveAll = () => {
    if (!documentId) {
      toast.error('Document ID is required');
      return;
    }
    approveDocumentMutation.mutate();
  };

  const claimReviewerMutation = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error('Document ID is required');
      return assignDocumentReviewer(documentId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] }),
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-documents'] }),
      ]);
      toast.success('You are now the assigned reviewer for this document');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to claim review');
    },
  });

  const undoSkippedMutation = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error('Document ID is required');
      return updateDocumentStatus(documentId, 'active');
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] }),
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-documents'] }),
      ]);
      toast.success('Document restored to active');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update document status');
    },
  });

  const resetAllSegmentsMutation = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error('Document ID is required');
      return resetSegments(documentId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] }),
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-documents'] }),
      ]);
      toast.success('Segments reset successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset segments');
    },
  });

  const reassignDocumentMutation = useMutation({
    mutationFn: async ({
      userId,
      userLabel,
    }: {
      userId: string;
      userLabel: string;
    }) => {
      if (!documentId) throw new Error('Document ID is required');
      await updateDocumentAssignee(documentId, userId);
      return { userLabel };
    },
    onSuccess: async ({ userLabel }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] }),
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-documents'] }),
      ]);
      setIsReassignDialogOpen(false);
      setUserSearch('');
      toast.success(`Document assigned to ${userLabel}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reassign document');
    },
  });

  const {
    data: assigneeSearchResults,
    isLoading: isLoadingAssigneeSearch,
    error: assigneeSearchError,
  } = useQuery({
    queryKey: ['outliner-document-assignee-search', userSearch.trim()],
    queryFn: () =>
      searchUsers(userSearch, {
        limit: 20,
        permission: 'outliner',
      }),
    enabled: isReassignDialogOpen,
    staleTime: 60 * 1000,
  });

  const handleResetAllSegments = () => {
    if (!documentId) {
      toast.error('Document ID is required');
      return;
    }
    if (
      !globalThis.confirm(
        '⚠️Are you sure you want to reset the segments? This action cannot be undone.'
      )
    ) {
      return;
    }
    if (!globalThis.confirm('⚠️Are you really sure?')) {
      return;
    }
    resetAllSegmentsMutation.mutate();
  };

  const handleReassignDialogChange = (open: boolean) => {
    setIsReassignDialogOpen(open);
    if (!open && !reassignDocumentMutation.isPending) {
      setUserSearch('');
    }
  };

  const assigneeCandidates = assigneeSearchResults?.items ?? [];
  const emptyAssigneeMessage = userSearch.trim()
    ? 'No matching users found.'
    : 'No users available.';
  let assigneeResultsContent: ReactNode;

  if (isLoadingAssigneeSearch) {
    assigneeResultsContent = (
      <div className="px-3 py-6 text-sm text-gray-500">Loading users...</div>
    );
  } else if (assigneeCandidates.length === 0) {
    assigneeResultsContent = (
      <div className="px-3 py-6 text-sm text-gray-500">{emptyAssigneeMessage}</div>
    );
  } else {
    assigneeResultsContent = assigneeCandidates.map((user) => {
      const isCurrentAssignee = user.id === selectedDocument?.user_id;
      const userLabel = user.name?.trim() || user.email;

      return (
        <button
          key={user.id}
          type="button"
          onClick={() =>
            reassignDocumentMutation.mutate({
              userId: user.id,
              userLabel,
            })
          }
          disabled={reassignDocumentMutation.isPending || isCurrentAssignee}
          className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-3 text-left last:border-b-0 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">
              {user.name || 'Unnamed user'}
            </p>
            <p className="truncate text-xs text-gray-500">{user.email}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {user.role ? (
              <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                {user.role}
              </span>
            ) : null}
            {isCurrentAssignee ? (
              <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">
                Current
              </span>
            ) : null}
          </div>
        </button>
      );
    });
  }

  const segmentsPanel =
    !loadingSegments && selectedDocument && segments.length > 0 ? (
      <>
        <header className="shrink-0 flex flex-col gap-4 pb-4 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ">
            <h2 className="text-base font-semibold text-gray-900 truncate">
              {selectedDocument.filename || `Document ${selectedDocument.id.slice(0, 8)}`}
            </h2>
            <div className="flex gap-2 text-xs px-2 flex-wrap">
              <span className="inline-block px-2 py-1 rounded bg-gray-100 text-gray-700">Reviewed: {statusCounts.approved}</span>
              <span className="inline-block px-2 py-1 rounded bg-red-100 text-red-700">Rejected: {statusCounts.rejected}</span>
              <span className="inline-block px-2 py-1 rounded bg-green-100 text-green-700">Annotated: {statusCounts.checked}</span>
              <span className="inline-block px-2 py-1 rounded bg-amber-100 text-amber-700">Annotating: {statusCounts.unchecked}</span>
              <span className="inline-block px-2 py-1 rounded bg-blue-100 text-blue-700">Submits: {selectedDocument.submit_count ?? 0}</span>
              {showSplitLimit && (
                <span
                  className={`inline-block px-2 py-1 rounded font-medium ${
                    splitLimitReached
                      ? 'bg-amber-200 text-amber-900 border border-amber-400'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                  title="Segments you can split off in this document before sending it back to the annotator. Starts again after the annotator fixes a rejected segment."
                >
                  {splitLimitReached ? 'Split limit reached' : 'Splits'}: {splitsUsed} / {splitLimit}
                  {splitLimit !== null && splitLimit > REVIEWER_SPLIT_LIMIT_DEFAULT && ' · long volume'}
                </span>
              )}
            </div>
       
          </div>
          {!canEditReview && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <p>
                {canClaimReview
                  ? 'View only — no reviewer is assigned yet.'
                  : 'View only — you are not the assigned reviewer for this document.'}
              </p>
              {/* {canClaimReview && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-amber-300 bg-white hover:bg-amber-100"
                  disabled={claimReviewerMutation.isPending}
                  onClick={() => claimReviewerMutation.mutate()}
                >
                  {claimReviewerMutation.isPending ? 'Claiming…' : 'Claim review'}
                </Button>
              )} */}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SegmentStatusFilter)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All ({segments.length})</option>
              <option value="unchecked">Annotating ({statusCounts.unchecked})</option>
              <option value="checked">Annotated({statusCounts.checked})</option>
              <option value="approved">Reviewed ({statusCounts.approved})</option>
              <option value="rejected">Rejected ({statusCounts.rejected})</option>
            </select>
            <div className="flex items-center gap-2">
              {selectedDocument.status === 'skipped' && (
                <Button
                  variant="outline"
                  onClick={() => undoSkippedMutation.mutate()}
                  disabled={undoSkippedMutation.isPending || !documentId || !canEditReview}
                >
                  {undoSkippedMutation.isPending ? 'Restoring...' : 'Undo skipped'}
                </Button>
              )}
              {hasImages && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 px-2"
                  onClick={() => setImagesPanelVisible((v) => !v)}
                  aria-pressed={imagesPanelVisible}
                  aria-label={
                    imagesPanelVisible
                      ? t('outliner.workspace.hideSidePanel')
                      : t('outliner.workspace.showSidePanel')
                  }
                  title={
                    imagesPanelVisible
                      ? t('outliner.workspace.hideSidePanel')
                      : t('outliner.workspace.showSidePanel')
                  }
                >
                  {imagesPanelVisible ? (
                    <PanelRightClose className="h-4 w-4" aria-hidden />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" aria-hidden />
                  )}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 px-2"
                    disabled={
                      resetAllSegmentsMutation.isPending ||
                      reassignDocumentMutation.isPending ||
                      !documentId ||
                      !canEditReview
                    }
                    aria-label="Document actions"
                  >
                    <EllipsisVertical className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleResetAllSegments}
                    className="text-red-600 focus:bg-red-50 focus:text-red-600"
                  >
                    <Undo className="h-4 w-4" aria-hidden />
                    {t('outliner.workspace.resetAllSegments')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setIsReassignDialogOpen(true)}
                    disabled={!documentId || reassignDocumentMutation.isPending}
                  >
                    Re-assign document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <AdminSanityCheckButton
                report={sanityCheck.report}
                isChecking={sanityCheck.isChecking}
                checkFailed={sanityCheck.checkFailed}
                onRunCheck={sanityCheck.runCheck}
                documentContent={documentContent}
                disabled={!documentId || loadingSegments || segments.length === 0}
                onNavigateToSegment={(segmentId, range) => {
                  setActiveSegmentId(segmentId);
                  requestScrollToSegment(segmentId);
                  const segment = segments.find((s) => s.id === segmentId);
                  const base = segment?.span_start;
                  if (!range || base == null) return;
                  // A collapsed row renders a truncated preview, so expand before flashing.
                  if (!expandedSegments.has(segmentId)) onToggleExpansion(segmentId);
                  flashSegmentRange(segmentId, range.start - base, range.end - base, {
                    // The row list settles over several frames; keep it in view meanwhile.
                    bringRowIntoView: () => requestScrollToSegment(segmentId),
                  });
                }}
              />
              <Button
                size="sm"
                onClick={handleApproveAll}
                disabled={
                  submittedThisVisit ||
                  approveDocumentMutation.isPending ||
                  !documentId ||
                  !canEditReview ||
                  statusCounts.approved < segments.length
                }
                className="cursor-pointer shrink-0"
                title={
                  submittedThisVisit
                    ? 'Reviewed'
                    : statusCounts.approved < segments.length
                      ? `${segments.length - statusCounts.approved} segment(s) are not yet approved`
                      : 'Approve document'
                }
              >
                {approveDocumentMutation.isPending ? 'Approving...' : 'Submit'}
              </Button>
            </div>
          </div>
        </header>
        <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="flex min-h-0 flex-1 flex-col px-2 pt-2">
            <List
              listRef={listRef}
              onRowsRendered={handleRowsRendered}
              className="min-h-0 w-full scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 [scrollbar-gutter:stable]"
              style={{ height: '100%' }}
              rowComponent={AdminDocumentSegmentRow}
              rowCount={filteredSegments.length}
              rowHeight={rowHeight}
              rowProps={{
                segments: filteredSegments,
                expandedSegments,
                onToggleExpansion,
                documentFilename: selectedDocument.filename,
                onSegmentBodyCaretChange: handleSegmentBodyCaretChange,
                canEditReview,
                sanityFindingsBySegmentId: sanityCheck.findingsBySegmentId,
                documentContent,
                nextSegmentById,
              }}
            />
          </div>
        </div>
      </>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col w-full min-w-0">
      {loadingSegments && (
        <div className="flex min-h-48 flex-1 flex-col items-center justify-center px-6 py-8 bg-white/90">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-600" />
            <span className="text-gray-600 text-sm">Loading segments...</span>
          </div>
        </div>
      )}

      {!loadingSegments && segments.length === 0 && selectedDocument && (
        <div className="flex flex-1 items-center justify-center py-16 px-6 bg-white/90 rounded-md border border-gray-200">
          <p className="text-gray-500 text-sm">No segments found for this document.</p>
        </div>
      )}

      {/* The segment list always renders in this same box. Opening or closing the image
          panel only adds or removes the panel beside it; moving the list to another parent
          would remount it and throw the reviewer back to segment 1. */}
      {segmentsPanel && selectedDocument && (
        <div ref={imageLayoutRef} className="flex min-h-0 w-full flex-1">
          <div
            className={`flex min-h-0 min-w-[280px] flex-1 flex-col ${
              showImagePanel ? 'overflow-hidden p-4' : ''
            }`}
          >
            {segmentsPanel}
          </div>
          {showImagePanel && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize image panel"
                className="w-2 shrink-0 cursor-col-resize touch-none bg-slate-400 transition-colors hover:bg-slate-500"
                onPointerDown={startImagePanelResize}
              />
              <div
                className="flex h-full min-h-0 min-w-[200px] max-w-[50%] shrink-0 flex-col overflow-hidden bg-white"
                style={{ width: imagePanelWidth ?? '30%' }}
              >
                <VolumeImagePanelCore
                  panelActive={imagesPanelVisible}
                  volumeFilename={
                    selectedDocument.filename?.trim() ? selectedDocument.filename : null
                  }
                  documentCharIndexForImage={documentCharIndexForImage}
                />
              </div>
            </>
          )}
        </div>
      )}

      <Dialog open={isReassignDialogOpen} onOpenChange={handleReassignDialogChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reassign document</DialogTitle>
            <DialogDescription>
              Search for a user with outliner access, then click a result to assign this
              document.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Search by name or email"
              disabled={reassignDocumentMutation.isPending}
              autoFocus
            />

            <div className="max-h-80 overflow-y-auto rounded-md border border-gray-200">
              {assigneeResultsContent}
            </div>

            {assigneeSearchError instanceof Error ? (
              <p className="text-sm text-red-600">{assigneeSearchError.message}</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SegmentsTab;
