import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/hooks/useUser';
import {
  getSegmentRejectionHistory,
  mergeSegments,
  rejectSegment,
  splitSegment,
  updateSegment,
  type MarkedSpan,
  type OutlineSegmentStatus,
  type SegmentRejection,
} from '@/api/outliner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SEGMENT_LABEL_VALUES } from '@/components/outliner/segment-label';
import type { SegmentLabel } from '@/components/outliner/types';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Check, FileText, History, Loader2, Merge, Scissors, Undo, User, X } from 'lucide-react';
import type { Segment } from '../shared/types';
import type { FormDataType } from '@/components/outliner/AnnotationSidebar';
import { useDocument } from '@/hooks';
import { getLabelColor, getStatusColor } from '@/components/outliner/utils';
import ChevronUporDown from '@/components/outliner/utils/ChevronUporDown';
import { SegmentSearchBar } from '@/components/outliner/SegmentSearchBar';
import { SegmentHighlightedText } from '@/components/outliner/SegmentHighlightedText';
import { ReviewerChangeBadges } from '@/components/outliner/ReviewerChangeBadges';
import { findAllOccurrences } from '@/features/outliner';
import { getSegmentHighlightWords } from '@/utils/segmentHighlightWords';
import { SegmentAttributionBar } from './SegmentAttributionBar';
import { useDocumentSegmentNav } from './DocumentSegmentNavContext';
import { MarkedTextChips } from './MarkedTextChips';
import { normalizeMarks, toMarkedSpans, type DraftMark } from './markedSpans';
import AdminSanityFindingIndicator from './AdminSanityFindingIndicator';
import type { SanityCheckFinding } from '@/api/outliner';

const REJECTION_REASONS = [
  'reconstructed ལ་འགྲིག་རྟགས་བཀོད་དགོས།',
  'reconstructed ལ་འགྲིག་རྟགས་བཀོད་མི་དགོས།',
  'ཆོས་ཚན་གཅོད་ལྷག་བྱུང་འདུག',
  'ཆོས་ཚན་འདི་གོང་དང་སྦྲེལ་དགོས།',
];

interface SegmentRowProps {
  readonly segment: Segment;
  readonly isExpanded: boolean;
  readonly onToggleExpansion: (segmentId: string) => void;
  readonly documentFilename?: string | null;
  /** 1-based index in the visible list (matches annotator workspace segment number). */
  readonly listIndex?: number;
  /**
   * Segment body caret for BDRC image sync (document index = span_start + offset).
   * Pass `offset: null` when this row no longer contributes (blur, collapse, unmount).
   */
  readonly onSegmentBodyCaretChange?: (segmentId: string, offset: number | null) => void;
  /** When false, segment review actions and title/author edits are read-only. */
  readonly canEditReview?: boolean;
  /** Sanity-check findings on this segment, once a check has been run. */
  readonly sanityFindings?: SanityCheckFinding[];
  /** Full document text, for showing the text each finding flags in the tooltip. */
  readonly documentContent?: string;
  /** Next segment in document order, for the reviewer's "Merge with next". */
  readonly nextSegment?: Segment;
}

/**
 * "Reconstructed" flag on the title: a toggle pill for the reviewer, yellow when on.
 * Read-only viewers only see it when it is on.
 */
function ReconstructedToggle({
  checked,
  editable,
  hint,
  onChange,
}: {
  readonly checked: boolean;
  readonly editable: boolean;
  readonly hint: string;
  readonly onChange: (checked: boolean) => void;
}) {
  const onClass = 'bg-yellow-100 text-yellow-800 border-yellow-300';
  if (!editable) {
    if (!checked) return null;
    return (
      <span title={hint} className={`shrink-0 self-start rounded-full border px-2 py-0.5 text-xs font-medium ${onClass}`}>
        Reconstructed
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className={`shrink-0 self-start inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
        checked ? `${onClass} hover:bg-yellow-200` : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
      }`}
    >
      {checked ? <Check className="w-3 h-3" aria-hidden /> : <span className="w-3 h-3 rounded-sm border border-gray-400" aria-hidden />}
      Reconstructed
    </button>
  );
}

/** null = no reviewer suggestion in DB; '' = explicit empty; else trimmed text. */
function storedReviewerNorm(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? '' : t;
}

/** Reviewer title: never treat '' as distinct from absent; empty input → null in API. */
function storedReviewerTitleNorm(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Normalized value to save from the input field (always a string: '' or trimmed text). */
function committedReviewerInput(raw: string): string {
  const t = raw.trim();
  return t === '' ? '' : t;
}

function SegmentRow({
  segment,
  isExpanded,
  onToggleExpansion,
  documentFilename,
  listIndex,
  onSegmentBodyCaretChange,
  canEditReview = false,
  sanityFindings,
  documentContent = '',
  nextSegment,
}: SegmentRowProps) {
  const { documentId } = useParams<{ documentId: string }>();
  const queryClient = useQueryClient();
  const { setActiveSegmentId, requestScrollToSegment } = useDocumentSegmentNav();
  const { user: reviewerAccount, isLoading: reviewerAccountLoading } = useUser();
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [selectedRejectReasons, setSelectedRejectReasons] = useState<string[]>([]);
  /** Body coordinates; converted to document offsets on submit. */
  const [rejectMarks, setRejectMarks] = useState<DraftMark[]>([]);
  const [rejectionHistoryOpen, setRejectionHistoryOpen] = useState(false);
  const rejectionCount = segment.rejection?.count ?? 0;
  const { document: selectedDocument, isLoading: isLoadingDocument } = useDocument(documentId);
  /** Reviewer may split/merge in the same window as Approve/Reject: submitted document, segment awaiting review. */
  const canRestructure =
    canEditReview && selectedDocument?.status === 'completed' && segment.status === 'checked';
  /** Reviewers may split off only a few segments per review round; past that they reject. Admins have no limit. */
  const splitLimit = selectedDocument?.reviewer_split_limit ?? null;
  const splitsUsed = selectedDocument?.reviewer_splits_used ?? 0;
  const splitLimitReached =
    reviewerAccount?.role !== 'admin' && splitLimit !== null && splitsUsed >= splitLimit;
  const canSplit = canRestructure && !splitLimitReached;
  /** Tells the reviewer the split limit is used up; they can close it and reject if they choose. */
  const [splitLimitDialogOpen, setSplitLimitDialogOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState('');
  const textBgColorStorageKey = `segment-text-bg-color:${segment.id}`;
  const [textBgColor, setTextBgColor] = useState('#ffffff');
  useEffect(() => {
    try {
      setTextBgColor(localStorage.getItem(textBgColorStorageKey) ?? '#ffffff');
    } catch {
      setTextBgColor('#ffffff');
    }
  }, [textBgColorStorageKey]);
  const handleTextBgColorChange = useCallback(
    (color: string) => {
      setTextBgColor(color);
      try {
        localStorage.setItem(textBgColorStorageKey, color);
      } catch {
      }
      if (!isExpanded) onToggleExpansion(segment.id);
    },
    [textBgColorStorageKey, isExpanded, onToggleExpansion, segment.id]
  );
  const segmentBodyRef = useRef<HTMLDivElement>(null);

  const highlightWords = useMemo(() => getSegmentHighlightWords(segment), [segment]);

  const searchWords = useMemo(
    () => (textSearchQuery.trim() ? [textSearchQuery.trim()] : []),
    [textSearchQuery]
  );

  const hasBodyHighlightLayer =
    searchWords.length > 0 ||
    highlightWords.titleWords.length > 0 ||
    highlightWords.authorWords.length > 0;

  const segmentSearchMatchCount = useMemo(
    () => findAllOccurrences(segment.text, textSearchQuery).length,
    [segment.text, textSearchQuery]
  );

  /**
   * `scrollIntoView` on `.highlighter` scrolls outer page/list containers instead of the body div,
   * so match navigation must set scrollTop on the inner scroll container.
   */
  const scrollBodyMatchIntoView = useCallback((matchIndex: number) => {
    const body = segmentBodyRef.current;
    if (!body) return;
    const hits = body.querySelectorAll('.highlighter');
    if (hits.length === 0) return;
    const safeIndex = Math.min(Math.max(0, matchIndex), hits.length - 1);
    const el = hits[safeIndex];
    if (!(el instanceof HTMLElement)) return;

    const containerRect = body.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const deltaTop = elRect.top - containerRect.top;
    const targetScrollTop =
      body.scrollTop + deltaTop - body.clientHeight / 2 + elRect.height / 2;
    const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
    body.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
  }, []);

  const scrollBodyToEdge = useCallback((edge: 'top' | 'bottom') => {
    const body = segmentBodyRef.current;
    if (!body) return;
    const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
    body.scrollTop = edge === 'top' ? 0 : maxScroll;
  }, []);

  const statusMutation = useMutation({
    mutationFn: (newStatus: 'approved' | 'unchecked' | 'checked') =>
      updateSegment(segment.id, {
        status: newStatus,
      }),
    onSuccess: (_data, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
      if (newStatus === 'checked' && segment.status === 'rejected') {
        queryClient.invalidateQueries({ queryKey: ['segment-rejection-history', segment.id] });
      }
      if (newStatus === 'approved') toast.success('Segment approved');
      else if (newStatus === 'checked') toast.success('Segment marked done again');
      else toast.success('Segment reset');
    },
    onError: (error: Error, newStatus) => {
      const action =
        newStatus === 'approved' ? 'approve' : newStatus === 'checked' ? 'update' : 'reset';
      toast.error(`Failed to ${action} segment: ${error.message}`);
    }  });

  const {
    data: rejectionHistory,
    isLoading: rejectionHistoryLoading,
    error: rejectionHistoryError,
  } = useQuery({
    queryKey: ['segment-rejection-history', segment.id],
    queryFn: () => getSegmentRejectionHistory(segment.id),
    enabled: rejectionHistoryOpen && rejectionCount > 0,
  });

  const rejectMutation = useMutation({
    mutationFn: (comment: string) =>
      rejectSegment(segment.id, comment, toMarkedSpans(rejectMarks, segment.span_start)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['segment-rejection-history', segment.id] });
      toast.success('Segment rejected');
      setRejectDialogOpen(false);
      setRejectComment('');
      setSelectedRejectReasons([]);
      setRejectMarks([]);
    },
    onError: (error: Error) => {
      toast.error(`Failed to reject segment: ${error.message}`);
    }
  });

  // Reviewer fixes the outline themselves instead of rejecting. The backend credits split-off
  // segments to the reviewer and marks the annotator's segment as corrected.
  const restructureSuccess = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
    toast.success(message);
  };
  // After a split the reviewer works on the new segment next: open it and bring it into view.
  // This segment keeps its id; the new one is right after it in document order.
  const openSplitOffSegment = async () => {
    toast.success('Segment split — the new segment is credited to you');
    const docKey = ['outliner-admin-document', documentId];
    await queryClient.invalidateQueries({ queryKey: docKey });
    const doc = queryClient.getQueryData<{ segments?: Segment[] }>(docKey);
    const newSegment = doc?.segments?.find((s) => s.segment_index === segment.segment_index + 1);
    if (!newSegment) return;
    onToggleExpansion(newSegment.id);
    setActiveSegmentId(newSegment.id);
    requestScrollToSegment(newSegment.id);
  };
  const splitMutation = useMutation({
    mutationFn: (splitPosition: number) => splitSegment(segment.id, splitPosition, documentId),
    onSuccess: openSplitOffSegment,
    onError: (error: Error) => {
      // The server refused for the limit (e.g. this page's count was stale): explain it.
      if (error.message.includes('Split limit reached')) {
        queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
        setSplitLimitDialogOpen(true);
        return;
      }
      toast.error(`Failed to split segment: ${error.message}`);
    },
  });
  const mergeMutation = useMutation({
    mutationFn: (nextId: string) => mergeSegments([segment.id, nextId]),
    onSuccess: () => restructureSuccess('Segments merged'),
    onError: (error: Error) => toast.error(`Failed to merge segments: ${error.message}`),
  });

  const handleSave = () => {
    statusMutation.mutate('approved');
  };

  const toggleRejectReason = (reason: string) => {
    setSelectedRejectReasons((prev) => {
      const next = prev.includes(reason)
        ? prev.filter((r) => r !== reason)
        : [...prev, reason];
      setRejectComment(next.join('\n'));
      return next;
    });
  };

  const handleConfirmReject = () => {
    const trimmed = rejectComment.trim();
    if (!trimmed) {
      toast.error('Please enter a comment explaining the rejection');
      return;
    }
    if (reviewerAccountLoading) {
      toast.error('Loading your account… try again in a moment.');
      return;
    }
    rejectMutation.mutate(trimmed);
  };

  const handleReset = () => {
    statusMutation.mutate('checked');
  };

  const handleUndoReject = () => {
    statusMutation.mutate('checked');
  };

  // --- Inline title / author (admin list) ---
  const [titleEditOpen, setTitleEditOpen] = useState(false);
  const [authorEditOpen, setAuthorEditOpen] = useState(false);
  const [titleInput, setTitleInput] = useState(() => {
    const rt = segment.reviewer_title;
    if (rt !== null && rt !== undefined) return rt;
    if (segment.title !== undefined && segment.title !== null && segment.title !== '') {
      return segment.title;
    }
    return '';
  });

  const [authorInput, setAuthorInput] = useState(() => {
    const ra = segment.reviewer_author;
    if (ra !== null && ra !== undefined) return ra;
    if (segment.author !== undefined && segment.author !== null && segment.author !== '') {
      return segment.author;
    }
    return '';
  });


  // Same flag as the annotator's "reconstructed" checkbox: title is not found in the text.
  // Shown from local state so the toggle is instant; the document refetch can take a while.
  const [suppliedTitleChecked, setSuppliedTitleChecked] = useState(segment.is_supplied_title ?? false);
  useEffect(() => {
    setSuppliedTitleChecked(segment.is_supplied_title ?? false);
  }, [segment.is_supplied_title]);
  const { mutate: patchSuppliedTitle } = useMutation({
    mutationFn: (checked: boolean) => updateSegment(segment.id, { is_supplied_title: checked }),
    onMutate: (checked) => setSuppliedTitleChecked(checked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
    },
    onError: (error: Error, checked) => {
      setSuppliedTitleChecked(!checked);
      toast.error(`Failed to update reconstructed title: ${error.message}`);
    },
  });

  const { mutate: patchTitleOrAuthor, isPending: titleAuthorSaving } = useMutation({
    mutationFn: (payload: { reviewer_title?: string | null; reviewer_author?: string | null }) =>
      updateSegment(segment.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
      toast.success('Reviewer suggestion saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });

  const { mutate: patchLabel, isPending: labelSaving } = useMutation({
    mutationFn: (label: SegmentLabel) => updateSegment(segment.id, { label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
      toast.success('Label updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update label: ${error.message}`);
    },
  });

  const commitTitle = useCallback(() => {
    const original= segment.title;
    const next = storedReviewerTitleNorm(titleInput);
    const prev = storedReviewerTitleNorm(segment.reviewer_title);
    setTitleEditOpen(false);
    if (original?.trim() === next?.trim()) return;
    if (next === null || next === undefined || next === prev ) return;
    patchTitleOrAuthor({ reviewer_title: next });
  }, [titleInput, segment.reviewer_title, patchTitleOrAuthor]);

  const commitAuthor = useCallback(() => {
    const original= segment.author;
    const next = committedReviewerInput(authorInput);
    const prev = storedReviewerNorm(segment.reviewer_author);
    setAuthorEditOpen(false);
    if (next === prev) return;
    if (original?.trim() === next?.trim()) return;
    if (next === null || next === undefined  || next === prev ) return;
    patchTitleOrAuthor({ reviewer_author: next });
  }, [authorInput, segment.reviewer_author, patchTitleOrAuthor]);

  const clearReviewerSuggestions = useCallback((segmentId: string) => {
    patchTitleOrAuthor({ reviewer_title: null, reviewer_author: null });
  }, [patchTitleOrAuthor]);

  const cancelTitleEdit = useCallback(() => {
    const rt = segment.reviewer_title;
    setTitleInput(rt !== null && rt !== undefined ? rt : (segment.title ?? ''));
    setTitleEditOpen(false);
  }, [segment.reviewer_title, segment.title]);

  const cancelAuthorEdit = useCallback(() => {
    const ra = segment.reviewer_author;
    setAuthorInput(ra !== null && ra !== undefined ? ra : (segment.author ?? ''));
    setAuthorEditOpen(false);
  }, [segment.reviewer_author, segment.author]);

  useEffect(() => {
    if (titleEditOpen) return;
    const rt = segment.reviewer_title;
    setTitleInput(rt !== null && rt !== undefined ? rt : (segment.title ?? ''));
  }, [segment.reviewer_title, segment.title, segment.id, titleEditOpen]);

  useEffect(() => {
    if (authorEditOpen) return;
    const ra = segment.reviewer_author;
    setAuthorInput(ra !== null && ra !== undefined ? ra : (segment.author ?? ''));
  }, [segment.reviewer_author, segment.author, segment.id, authorEditOpen]);

  // --- BDRC field state ---
  const [formData, setFormData] = useState<FormDataType>({
    title: { name: segment.title || '', bdrc_id: segment.title_bdrc_id || '' },
    author: { id: '', name: segment.author || '', bdrc_id: segment.author_bdrc_id || '' },
  });
  const initialBdrcIdRef = useRef(segment.title_bdrc_id || '');

  useEffect(() => {
    setFormData({
      title: { name: segment.title || '', bdrc_id: segment.title_bdrc_id || '' },
      author: { id: '', name: segment.author || '', bdrc_id: segment.author_bdrc_id || '' },
    });
    initialBdrcIdRef.current = segment.title_bdrc_id || '';
  }, [segment.id, segment.title, segment.author, segment.title_bdrc_id, segment.author_bdrc_id]);

  const bdrcSaveMutation = useMutation({
    mutationFn: (bdrcId: string) =>
      updateSegment(segment.id, { title_bdrc_id: bdrcId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outliner-admin-document', documentId] });
      toast.success('BDRC match saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save BDRC match: ${error.message}`);
    },
  });

  const bdrcSaveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bdrcSaveMutationRef = useRef(bdrcSaveMutation);
  bdrcSaveMutationRef.current = bdrcSaveMutation;

  useEffect(() => {
    if (!canEditReview) return;
    const currentBdrcId = formData.title.bdrc_id;
    if (currentBdrcId === initialBdrcIdRef.current) return;

    clearTimeout(bdrcSaveTimeoutRef.current);
    bdrcSaveTimeoutRef.current = setTimeout(() => {
      initialBdrcIdRef.current = currentBdrcId;
      bdrcSaveMutationRef.current.mutate(currentBdrcId);
    }, 1000);

    return () => clearTimeout(bdrcSaveTimeoutRef.current);
  }, [formData.title.bdrc_id, canEditReview]);





  const toggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpansion(segment.id);
    },
    [onToggleExpansion, segment.id]
  );

  /**
   * Selecting text no longer marks it as wrong by itself — it just surfaces a
   * "Reject" bubble next to the selection. The selection is deliberately left
   * in place so Ctrl+C keeps working — reviewers paste the copied text into
   * the title/author suggestion fields instead of retyping Tibetan. The
   * offsets are captured now because clicking the bubble button collapses the
   * live selection before the click handler runs.
   *
   * Runs alongside `reportBodyCaret`, which handles the collapsed-caret case for image sync.
   *
   * "Split here" lives in the same bubble and cuts at the selection start. A plain click
   * deliberately opens nothing: reviewers click to sync the volume image, and a click in the
   * blank space after a line would place the cut away from where the bubble appears.
   */
  const [selectionBubble, setSelectionBubble] = useState<{
    x: number;
    y: number;
    start: number;
    end: number;
  } | null>(null);
  const selectionBubbleRef = useRef<HTMLDivElement>(null);

  const handleBodySelectionPreview = useCallback(() => {
    if (!canEditReview) return;
    const el = segmentBodyRef.current;
    if (!el) return;
    const selection = globalThis.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionBubble(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      setSelectionBubble(null);
      return;
    }

    const offsetOf = (container: Node, nodeOffset: number) => {
      const pre = range.cloneRange();
      pre.selectNodeContents(el);
      pre.setEnd(container, nodeOffset);
      return pre.toString().length;
    };
    const a = offsetOf(range.startContainer, range.startOffset);
    const b = offsetOf(range.endContainer, range.endOffset);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end <= start) {
      setSelectionBubble(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    setSelectionBubble({ x: rect.left + rect.width / 2, y: rect.top, start, end });
  }, [canEditReview]);

  const confirmSelectionReject = useCallback(() => {
    setSelectionBubble((current) => {
      if (!current) return null;
      const { start, end } = current;
      setRejectMarks((prev) => normalizeMarks([...prev, { start, end }]));
      return null;
    });
  }, []);

  // Dismiss the bubble on any click outside it; a new drag inside the body is
  // left alone so the mouseup handler above can replace it instead of racing it.
  useEffect(() => {
    if (!selectionBubble) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (selectionBubbleRef.current?.contains(target)) return;
      if (segmentBodyRef.current?.contains(target)) return;
      setSelectionBubble(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [selectionBubble]);

  const removeMarkAt = useCallback((start: number) => {
    setRejectMarks((prev) => prev.filter((m) => m.start !== start));
  }, []);

  const isRejected = segment.status === 'rejected';

  /**
   * Rejected marks are already red, so clicking a chip only outlines them —
   * a selection there would fight the highlight. While drafting nothing is
   * painted, so the passage is re-selected natively and stays copyable.
   */
  const scrollToMark = useCallback(
    (start: number, end: number) => {
      if (!isExpanded) onToggleExpansion(segment.id);
      setTimeout(() => {
        const root = segmentBodyRef.current;
        if (!root) return;

        if (isRejected) {
          const el = root.querySelector<HTMLElement>(`[data-mark-offset="${start}"]`);
          if (!el) return;
          const target =
            root.scrollTop +
            (el.getBoundingClientRect().top - root.getBoundingClientRect().top) -
            root.clientHeight / 2 +
            el.offsetHeight / 2;
          root.scrollTop = Math.max(0, Math.min(target, root.scrollHeight - root.clientHeight));
          el.classList.add('ring-2', 'ring-red-600', 'ring-offset-1');
          setTimeout(
            () => el.classList.remove('ring-2', 'ring-red-600', 'ring-offset-1'),
            1200
          );
          return;
        }

        /** Walk text nodes to turn body-relative offsets back into a DOM range. */
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let consumed = 0;
        let startNode: Text | null = null;
        let startOffset = 0;
        let endNode: Text | null = null;
        let endOffset = 0;
        let node = walker.nextNode() as Text | null;
        while (node) {
          const len = node.data.length;
          if (!startNode && consumed + len >= start) {
            startNode = node;
            startOffset = start - consumed;
          }
          if (consumed + len >= end) {
            endNode = node;
            endOffset = end - consumed;
            break;
          }
          consumed += len;
          node = walker.nextNode() as Text | null;
        }
        if (!startNode || !endNode) return;

        const range = document.createRange();
        range.setStart(startNode, Math.max(0, Math.min(startOffset, startNode.data.length)));
        range.setEnd(endNode, Math.max(0, Math.min(endOffset, endNode.data.length)));
        const selection = globalThis.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const rect = range.getBoundingClientRect();
        const hostRect = root.getBoundingClientRect();
        const target =
          root.scrollTop + (rect.top - hostRect.top) - root.clientHeight / 2 + rect.height / 2;
        root.scrollTop = Math.max(0, Math.min(target, root.scrollHeight - root.clientHeight));
      }, isExpanded ? 0 : 60);
    },
    [isExpanded, isRejected, onToggleExpansion, segment.id]
  );

  // Not cleared on blur: clicking the zoomable image blurs the body, and dropping
  // the offset would snap the panel back to span_start. Collapse/unmount clear it.
  const reportBodyCaret = useCallback(() => {
    if (!onSegmentBodyCaretChange || !segmentBodyRef.current) return;
    const el = segmentBodyRef.current;
    const selection = globalThis.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    const offsetFromRangePoint = (container: Node, nodeOffset: number) => {
      const pre = range.cloneRange();
      pre.selectNodeContents(el);
      pre.setEnd(container, nodeOffset);
      return pre.toString().length;
    };

    const offset = Math.min(
      offsetFromRangePoint(range.startContainer, range.startOffset),
      offsetFromRangePoint(range.endContainer, range.endOffset)
    );
    onSegmentBodyCaretChange(segment.id, offset);
  }, [onSegmentBodyCaretChange, segment.id]);

  useEffect(() => {
    if (!isExpanded) {
      onSegmentBodyCaretChange?.(segment.id, null);
      setSelectionBubble(null);
    }
  }, [isExpanded, segment.id, onSegmentBodyCaretChange]);

  useEffect(() => {
    return () => {
      onSegmentBodyCaretChange?.(segment.id, null);
    };
  }, [segment.id, onSegmentBodyCaretChange]);

  




  /**
   * Marks saved with a past rejection, converted document-absolute → body-relative
   * for display. Clipped in case a split re-bounded the segment since. Mirrors the
   * annotator view so a reviewer revisiting a rejected segment sees what was flagged.
   */
  const savedRejectionMarks = useMemo(() => {
    const spans = segment.rejection?.marked_spans;
    if (!isRejected || !spans?.length || segment.span_start == null) return [];
    const base = segment.span_start;
    const length = segment.text.length;
    return spans
      .map((s) => ({
        start: Math.max(0, s.start - base),
        end: Math.min(length, s.end - base),
        note: s.note ?? undefined,
      }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);
  }, [isRejected, segment.rejection?.marked_spans, segment.span_start, segment.text.length]);
  /**
   * Labels for a historical rejection's marks. Offsets are document-absolute and
   * may predate a split, so anything that no longer lands inside this segment is
   * shown by offset rather than dropped — the reviewer still learns a mark existed.
   */
  const historyMarkLabels = useCallback(
    (spans: MarkedSpan[] | null | undefined) => {
      if (!spans?.length || segment.span_start == null) return [];
      const base = segment.span_start;
      const length = segment.text.length;
      return spans.map((s, i) => {
        const start = s.start - base;
        const end = s.end - base;
        const inRange = start >= 0 && end <= length && end > start;
        return {
          key: `${s.start}-${s.end}-${i}`,
          label: inRange
            ? segment.text.slice(start, end)
            : `— text moved (chars ${s.start}–${s.end}) —`,
          note: s.note ?? undefined,
        };
      });
    },
    [segment.span_start, segment.text]
  );
  const isApproved = segment.status === 'approved';
  const showApproveButton= selectedDocument?.status==='completed';
  const isRestructuring = splitMutation.isPending || mergeMutation.isPending;
  const isSaving = statusMutation.isPending || rejectMutation.isPending || titleAuthorSaving || bdrcSaveMutation.isPending || isRestructuring;
  // Merging deletes the next segment, so only take one that is also still awaiting review.
  const canMergeWithNext = canRestructure && nextSegment?.status === 'checked';

  const splitAtSelection = () => {
    if (!selectionBubble || !canRestructure) return;
    const { start } = selectionBubble;
    setSelectionBubble(null);
    if (splitLimitReached) {
      setSplitLimitDialogOpen(true);
      return;
    }
    if (start <= 0 || start >= segment.text.length) {
      toast.error('Select text inside the segment, not at its very start');
      return;
    }
    if (!globalThis.confirm('Split this segment here? The new segment starts at the selected text.')) return;
    splitMutation.mutate(start);
  };

  const handleMergeWithNext = () => {
    if (!nextSegment) return;
    if (!globalThis.confirm('Merge this segment with the next one?')) return;
    mergeMutation.mutate(nextSegment.id);
  };
  const annotatorTitle = (
    <span className="flex items-center gap-2 text-xl">
      {segment.title?.trim() ? segment.title : '— No annotator title —'}
    </span>
  );
  return (
    <div
      id={segment.id}
      className={`rounded-lg border-2 p-4 transition-colors ${
        isRejected
          ? 'border-red-400 bg-red-50'
          : isApproved
            ? 'border-blue-300 bg-blue-50/40'
            : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100/80'
      }`}
    >
      {selectionBubble &&
        createPortal(
          <div
            ref={selectionBubbleRef}
            className="fixed z-[9999] -translate-x-1/2 -translate-y-full pb-2"
            style={{ left: selectionBubble.x, top: selectionBubble.y }}
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={confirmSelectionReject}
                className="flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg cursor-pointer hover:bg-red-700"
              >
                <X className="h-3 w-3 shrink-0" aria-hidden />
                Reject
              </button>
              {canRestructure && (
                <button
                  type="button"
                  onClick={splitAtSelection}
                  disabled={isSaving}
                  title={
                    splitLimitReached
                      ? `You have added ${splitsUsed} of ${splitLimit} segments allowed in this document. Reject and send it back to the annotator instead.`
                      : splitLimit !== null && reviewerAccount?.role !== 'admin'
                        ? `Start a new segment at the selected text (${splitsUsed} of ${splitLimit} used)`
                        : 'Start a new segment at the selected text'
                  }
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-lg cursor-pointer disabled:opacity-60 ${
                    splitLimitReached ? 'bg-gray-500 hover:bg-gray-600' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <Scissors className="h-3 w-3 shrink-0" aria-hidden />
                  {splitLimitReached ? `Split limit reached (${splitsUsed}/${splitLimit})` : 'Split here'}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={toggleCollapse}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            aria-label={isExpanded ? 'Collapse segment' : 'Expand segment'}
          >
            <ChevronUporDown isExpanded={isExpanded} />
          </button>
          {listIndex != null && (
            <div className='relative'>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
               getStatusColor(segment.status)
              }`}
            >
              {listIndex}
            </div>
            <div className='transform rotate-270 absolute top-20 left-[-20px]'>

            <StatusBadge status={segment.status} rejection={segment.rejection} />
             </div>
              </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-3 font-monlam-2">
          <div className="space-y-2 pb-2 border-b border-gray-200">
        
            <div className="flex flex-wrap justify-between items-center gap-2">
             {(segment.label ||
               canEditReview ||
               Boolean(sanityFindings?.length) ||
               segment.created_by_id ||
               segment.corrected_by_reviewer) && (
             <div className="inline-flex  items-center gap-1 mt-2 mb-1">
               <ReviewerChangeBadges segment={segment} />
               {canEditReview ? (
                 <div onClick={(e) => e.stopPropagation()}>
                   <Select
                     value={segment.label ?? undefined}
                     onValueChange={(value) => patchLabel(value as SegmentLabel)}
                     disabled={labelSaving}
                   >
                     <SelectTrigger
                       className={
                         "h-7 text-sm font-semibold rounded-full border-0 " +
                         (segment.label ? getLabelColor(segment.label) : '')
                       }
                       aria-label="Segment label"
                     >
                       <SelectValue placeholder="Set label" />
                     </SelectTrigger>
                     <SelectContent>
                       {SEGMENT_LABEL_VALUES.filter((v): v is SegmentLabel => v !== 'none').map((opt) => (
                         <SelectItem key={opt} value={opt}>
                           {opt}
                         </SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>
               ) : segment.label && (
                 <span
                   className={
                     "px-2 text-sm font-semibold py-0.5 rounded-full  " +
                     getLabelColor(segment.label)
                   }
                   title={`Label: ${segment.label}`}
                 >
                   {segment.label.charAt(0).toUpperCase() + segment.label.slice(1)}
                 </span>
               )}
               <AdminSanityFindingIndicator
                 findings={sanityFindings}
                 textContent={documentContent}
               />
             </div>
           )}
            <div className="min-w-0 " onClick={(e) => e.stopPropagation()}>
              <SegmentSearchBar
                segmentId={segment.id}
                query={textSearchQuery}
                onQueryChange={setTextSearchQuery}
                matchCount={segmentSearchMatchCount}
                disableMatchNavigation={!isExpanded}
                scrollBodyMatchIntoView={scrollBodyMatchIntoView}
                scrollBodyToEdge={scrollBodyToEdge}
                bgColor={textBgColor}
                onBgColorChange={handleTextBgColorChange}
              />
            </div>
            </div>
          </div>

          {/* Marks can exist without a comment, so either one shows the banner. */}
          {isRejected && (segment.rejection?.reason?.trim() || savedRejectionMarks.length > 0) ? (
            <div className="rounded-md border border-red-200 bg-red-100/60 px-3 py-2 text-sm text-red-900">
              {segment.rejection?.reason?.trim() ? (
                <>
                  <span className="font-semibold text-red-800">Rejection note: </span>
                  <span className="whitespace-pre-wrap">{segment.rejection.reason}</span>
                </>
              ) : null}
              {savedRejectionMarks.length > 0 ? (
                <div className={segment.rejection?.reason?.trim() ? 'mt-2' : undefined}>
                  <span className="font-semibold text-red-800">
                    Marked as wrong ({savedRejectionMarks.length}):
                  </span>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {savedRejectionMarks.map((mark) => (
                      <li key={mark.start} className="flex max-w-full">
                        <button
                          type="button"
                          onClick={() => scrollToMark(mark.start, mark.end)}
                          title={`Select “${segment.text.slice(mark.start, mark.end)}” in the text`}
                          className="flex min-w-0 items-center gap-1 rounded-full border border-red-300 bg-white px-2 py-1 text-left hover:bg-red-50"
                        >
                          <span className="min-w-0 max-w-[16rem] truncate font-monlam text-xs leading-relaxed py-0.5 text-gray-800">
                            {segment.text.slice(mark.start, mark.end)}
                          </span>
                          {mark.note ? (
                            <span
                              className="max-w-[10rem] shrink truncate text-xs text-gray-500"
                              title={mark.note}
                            >
                              — {mark.note}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
           
            {isExpanded ? (
              <div
                ref={segmentBodyRef}
                data-segment-body-id={segment.id}
                tabIndex={0}
                aria-label="Segment text (read-only; click to sync volume image)"
                onMouseUp={() => {
                  reportBodyCaret();
                  handleBodySelectionPreview();
                }}
                onFocus={reportBodyCaret}
                // onBlur={() => onSegmentBodyCaretChange?.(segment.id, null)}
                style={{ backgroundColor: textBgColor }}
                className="min-h-[8rem] max-h-[min(24rem,50vh)] overflow-y-auto whitespace-pre-wrap wrap-break-word p-3 font-monlam text-sm leading-normal text-gray-800 rounded-md border border-gray-200 cursor-text select-text outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20"
              >
                {/* Empty unless rejected, so nothing is painted while drafting. */}
                <SegmentHighlightedText
                  text={segment.text}
                  titleWords={highlightWords.titleWords}
                  authorWords={highlightWords.authorWords}
                  searchWords={searchWords}
                  markedSpans={savedRejectionMarks}
                />
              </div>
            ) : (
              <button
                type="button"
                className="text-left w-full text-gray-700 font-monlam text-sm py-1 rounded px-2 -mx-2 transition-colors max-h-[100px] overflow-hidden whitespace-pre-wrap break-words [display:-webkit-box] [WebkitBoxOrient:vertical] [WebkitLineClamp:4] hover:bg-white/60"
                onClick={toggleCollapse}
              >
                {hasBodyHighlightLayer ? (
                  <SegmentHighlightedText
                    text={
                      segment.text.length > 200
                        ? `${segment.text.slice(0, 200)}…`
                        : segment.text
                    }
                    titleWords={highlightWords.titleWords}
                    authorWords={highlightWords.authorWords}
                    searchWords={searchWords}
                  />
                ) : (
                  `${segment.text.length > 200 ? `${segment.text.slice(0, 200)}…` : segment.text}`
                )}
              </button>
            )}

            {canEditReview && isExpanded && (
              <MarkedTextChips
                text={segment.text}
                marks={rejectMarks}
                onScrollTo={scrollToMark}
                onRemove={removeMarkAt}
                onNoteChange={(start, note) =>
                  setRejectMarks((prev) =>
                    prev.map((m) => (m.start === start ? { ...m, note: note || undefined } : m))
                  )
                }
                onClearAll={() => setRejectMarks([])}
                canSplit={canSplit}
              />
            )}
          </div>
       
      
          <div className="relative text-sm flex flex-col gap-2 min-w-0" onClick={(e) => e.stopPropagation()}>
            {titleAuthorSaving && (
              <div className="absolute inset-0 z-10 bg-white/50 backdrop-blur-sm flex items-center justify-center gap-2 rounded">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
                Saving...
              </div>
            )}
            {
            segment.label==='TEXT' && (
              <>
            <div className="flex w-full min-w-0 gap-1">
              <span className="text-xs min-w-0 flex-1 font-medium text-gray-500 flex gap-1 items-center">
                <FileText className="w-5 h-5 shrink-0" aria-hidden /> 

                {titleEditOpen && canEditReview ? (
                  <Input
                    autoFocus
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onBlur={() => commitTitle()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitTitle();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelTitleEdit();
                      }
                    }}
                    disabled={titleAuthorSaving}
                    className="h-8 flex-1 text-sm font-monlam max-w-full"
                    placeholder="Reviewer suggestion (annotator title unchanged until they apply)"
                  />
                ) : canEditReview ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left font-medium text-gray-900 font-monlam rounded px-1 py-0.5 -mx-1 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
                    onClick={() => {
                      setAuthorEditOpen(false);
                      const rt = segment.reviewer_title;
                      setTitleInput(rt !== null && rt !== undefined ? rt : (segment.title ?? ''));
                      setTitleEditOpen(true);
                    }}
                    disabled={titleAuthorSaving}
                    title="Annotator title; click to edit reviewer suggestion only"
                  >
                    {annotatorTitle}
                    {segment.reviewer_title != null ? (
                      <span className="block text-xs font-normal text-sky-800 mt-0.5">
                        Suggestion:{' '}
                        {segment.reviewer_title.trim() ? segment.reviewer_title : '— Empty —'}
                      </span>
                    ) : (
                      <span className="block text-xs font-normal text-gray-500 mt-0.5">
                        Click to add reviewer suggestion
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="text-left font-medium text-gray-900 font-monlam px-1 py-0.5">
                    {annotatorTitle}
                    {segment.reviewer_title != null ? (
                      <span className="block text-xs font-normal text-sky-800 mt-0.5">
                        Suggestion:{' '}
                        {segment.reviewer_title.trim() ? segment.reviewer_title : '— Empty —'}
                      </span>
                    ) : null}
                  </div>
                )}
              </span>
              <ReconstructedToggle
                checked={suppliedTitleChecked}
                editable={canEditReview}
                hint="Title is not in the text: written in from the cover, front matter, or elsewhere"
                onChange={patchSuppliedTitle}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500 flex gap-1 items-center">
                <User className="w-5 h-5 shrink-0" aria-hidden />
                {authorEditOpen && canEditReview ? (
                  <Input
                    autoFocus
                    value={authorInput}
                    onChange={(e) => setAuthorInput(e.target.value)}
                    onBlur={() => commitAuthor()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitAuthor();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelAuthorEdit();
                      }
                    }}
                    disabled={titleAuthorSaving}
                    className="h-8 text-sm font-monlam max-w-full"
                    placeholder="Reviewer suggestion (annotator author unchanged until they apply)"
                  />
                ) : canEditReview ? (
                  <button
                    type="button"
                    className="text-left text-gray-700 text-sm font-monlam rounded px-1 py-0.5 -mx-1 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
                    onClick={() => {
                      setTitleEditOpen(false);
                      const ra = segment.reviewer_author;
                      setAuthorInput(ra !== null && ra !== undefined ? ra : (segment.author ?? ''));
                      setAuthorEditOpen(true);
                    }}
                    disabled={titleAuthorSaving}
                    title="Annotator author; click to edit reviewer suggestion only"
                  >
                    <span className="block text-xl">
                      {segment.author?.trim() ? segment.author : '— No annotator author —'}
                    </span>
                    {segment.reviewer_author != null ? (
                      <span className="block text-xs font-normal text-sky-800 mt-0.5">
                        Suggestion:{' '}
                        {segment.reviewer_author.trim() ? segment.reviewer_author : '— Empty —'}
                      </span>
                    ) : (
                      <span className="block text-xs font-normal text-gray-500 mt-0.5">
                        Click to add reviewer suggestion
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="text-left text-gray-700 text-sm font-monlam px-1 py-0.5">
                    <span className="block text-xl">
                      {segment.author?.trim() ? segment.author : '— No annotator author —'}
                    </span>
                    {segment.reviewer_author != null ? (
                      <span className="block text-xs font-normal text-sky-800 mt-0.5">
                        Suggestion:{' '}
                        {segment.reviewer_author.trim() ? segment.reviewer_author : '— Empty —'}
                      </span>
                    ) : null}
                  </div>
                )}
              </span>
            </div>
            </>)
            }

            
          </div>

          <div className="min-w-0 pt-1 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
            {/* <BDRCField
              segment={segmentAsTextSegment}
              formData={formData}
              onUpdate={handleBdrcUpdate}
              resetForm={resetBdrcForm}
              disabled={segment.status === 'approved'}
              volumeId={documentFilename ?? undefined}
              annotatorAuthorName={formData.author.name}
            /> */}
          </div>

          <div className="flex flex-wrap gap-2 pt-1 justify-between" onClick={(e) => e.stopPropagation()}>
           
            {canEditReview && segment.status === 'checked' && showApproveButton && (
              <div className='flex gap-2'>
                <Button size="sm" onClick={handleSave} disabled={isSaving} variant="outline" className='cursor-pointer hover:bg-blue-50 hover:border-blue-400'>
                  {isSaving ? <Loader2 className='w-3.5 h-3.5 animate-spin shrink-0' aria-hidden /> : <Check className='w-3.5 h-3.5 shrink-0' aria-hidden />}
                  Approve
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setRejectComment('');
                    setSelectedRejectReasons([]);
                    setRejectDialogOpen(true);
                  }}
                  disabled={isSaving}
                  variant="ghost"
                  className="border-red-300 cursor-pointer text-red-600 hover:bg-red-50 hover:border-red-400"
                >
                  <X className='w-3.5 h-3.5 shrink-0' aria-hidden />
                  Reject
                </Button>
                {canMergeWithNext && (
                  <Button
                    size="sm"
                    onClick={handleMergeWithNext}
                    disabled={isSaving}
                    variant="outline"
                    title="Join this segment with the next one"
                    className="cursor-pointer hover:bg-emerald-50 hover:border-emerald-400"
                  >
                    <Merge className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    Merge with next
                  </Button>
                )}
              </div>
            )}
            {canEditReview && segment.status === 'approved' && (
              <Button size="sm" onClick={handleReset} disabled={isSaving} variant="outline">
                <Undo className="w-3.5 h-3.5 shrink-0" aria-hidden />
                Undo
              </Button>
            )}
            {canEditReview && segment.status === 'rejected' && (
              <Button size="sm" onClick={handleUndoReject} disabled={isSaving} variant="outline">
                Undo reject 
              </Button>
            )}
            {canEditReview &&
              (segment.reviewer_title != null || segment.reviewer_author != null) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={titleAuthorSaving}
                  onClick={(e) => {
                    e.stopPropagation();
                    clearReviewerSuggestions(segment.id);
                  }}
                  className='w-min'
                >
                <X className="text-red-500 w-3.5 h-3.5 shrink-0" aria-hidden />Clear suggestions
                </Button>
            )}
             {rejectionCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 border-red-200 text-red-800 hover:bg-red-50"
                onClick={() => setRejectionHistoryOpen(true)}
              >
                <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
               
                {rejectionCount > 1 ? ` (${rejectionCount})` : ''}
              </Button>
            )}
          </div>
          <SegmentAttributionBar
              annotator={segment.annotator}
              reviewedBy={segment.reviewed_by}
              reviewedAt={segment.reviewed_at}
              updatedAt={segment.updated_at}
              isAnnotated={segment.is_annotated}
              canEditReview={canEditReview}
            />
        </div>
        
      </div>


      <Dialog open={rejectionHistoryOpen} onOpenChange={setRejectionHistoryOpen}>
        <DialogContent
          className="sm:max-w-lg max-h-[min(85vh,32rem)] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>History</DialogTitle>
            <DialogDescription>
              {rejectionCount === 1
                ? 'One rejection recorded for this segment.'
                : `${rejectionCount} rejections recorded for this segment (newest first).`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
            {rejectionHistoryLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading history…
              </div>
            ) : rejectionHistoryError instanceof Error ? (
              <p className="text-sm text-red-600 py-4">{rejectionHistoryError.message}</p>
            ) : (rejectionHistory?.items.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-500 py-4">No rejection records found.</p>
            ) : (
              rejectionHistory?.items.map((item) => {
                const when = item.created_at
                  ? format(new Date(item.created_at), 'PPp')
                  : 'Unknown date';
                const reviewerName =
                  item.reviewer?.name?.trim() || 'Unknown reviewer';
                const reviewerPicture = item.reviewer?.picture;
                return (
                  <article
                    key={item.id}
                    className={`rounded-md border px-3 py-2.5 text-sm `}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <time className="text-xs font-medium text-gray-600" dateTime={item.created_at}>
                        {when}
                      </time>
                      <div className="flex flex-wrap items-center gap-1.5">
                   
                        {item.resolved ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800">
                            Resolved
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><img src={reviewerPicture ?? ''} alt={reviewerName} className="w-4 h-4 rounded-full" /> {reviewerName}</p>
                    <p className="whitespace-pre-wrap text-gray-900">
                      {item.reason?.trim() ? item.reason : '— No comment provided —'}
                    </p>
                    {historyMarkLabels(item.marked_spans).length > 0 ? (
                      <div className="mt-1.5">
                        <span className="text-xs font-medium text-red-800">Marked as wrong:</span>
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {historyMarkLabels(item.marked_spans).map((mark) => (
                            <li key={mark.key} className="flex max-w-full">
                              <span className="flex min-w-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1">
                                <span className="min-w-0 max-w-[16rem] truncate font-monlam text-xs leading-relaxed py-0.5 text-gray-800">
                                  {mark.label}
                                </span>
                                {mark.note ? (
                                  <span
                                    className="max-w-[10rem] shrink truncate text-xs text-gray-500"
                                    title={mark.note}
                                  >
                                    — {mark.note}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectionHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={splitLimitDialogOpen} onOpenChange={setSplitLimitDialogOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Split limit reached</DialogTitle>
            <DialogDescription>
              You have used all {splitLimit} splits for this document ({splitsUsed} / {splitLimit}).
              If more segments are missing, reject the segment so the annotator fixes it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => setSplitLimitDialogOpen(false)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Reject segment</DialogTitle>
            <DialogDescription>
              Explain what needs to change. The annotator will see this on the rejected segment.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {REJECTION_REASONS.map((reason) => (
              <label key={reason} className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={selectedRejectReasons.includes(reason)}
                  onCheckedChange={() => toggleRejectReason(reason)}
                  disabled={rejectMutation.isPending}
                  className="mt-0.5"
                />
                <span className="font-monlam">{reason}</span>
              </label>
            ))}
          </div>
          <Textarea
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Reason for rejection (required)"
            className="min-h-[100px] text-sm"
            disabled={rejectMutation.isPending}
          />
          {rejectMarks.length > 0 && (
            <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-900">
              {rejectMarks.length} marked {rejectMarks.length === 1 ? 'passage' : 'passages'} will
              be sent with this rejection.
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={rejectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmReject}
              disabled={
                rejectMutation.isPending ||
                !rejectComment.trim() ||
                reviewerAccountLoading ||
                !reviewerAccount?.id
              }
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Reject segment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SegmentRow;




function StatusBadge({
  status,
  rejection,
}: {
  status?: OutlineSegmentStatus | string | null;
  rejection?: SegmentRejection | null;
}) {
  return (
    <>
    {status === 'approved' ? (
      <span
      className="inline-block rounded-full bg-blue-100 text-blue-800 px-2 py-1 text-xs font-semibold"
      title="Segment approved"
      >
        Reviewed
      </span>
    ) : status === 'rejected' ? (
      <span
      className="inline-block rounded-full bg-red-100 text-red-800 px-2 py-1 text-xs font-semibold"
        title="Segment rejected"
      >
        Rejected
        {(rejection?.count ?? 0) > 1 ? ` (${rejection?.count ?? 0}x)` : ''}
      </span>
    ) : (
      <span
      className={
        status === 'checked'
        ? 'inline-block rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs font-semibold'
        : 'inline-block rounded-full bg-yellow-100 text-yellow-800 px-2 py-1 text-xs font-semibold'
      }
      title={status === 'checked' ? 'Segment done' : 'Segment in progress'}
      >
        {status === 'checked' ? 'Annotated' : 'Annotating'}
      </span>
    )}
    </>
  );
}