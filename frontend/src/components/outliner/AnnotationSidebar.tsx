import {
  forwardRef,
  memo,
  useImperativeHandle,
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TextSegment } from './types';
import { segmentLabelI18nKey } from './segment-label';
import { FilterSegments, type LabelFilterValue, type CompletionFilterValue } from './FilterSegments';
import { useAISuggestions } from '@/hooks/useAISuggestions';
import { findPhraseDocSpan } from '@/utils/findPhraseDocSpan';
import { useOutlinerDocument } from '@/hooks/useOutlinerDocument';
import type { SegmentUpdateRequest } from '@/api/outliner';
import { toast } from 'sonner';
import { User, AlertCircle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { ListImperativeAPI } from 'react-window';
import { AnnotationMetadataTab } from './AnnotationMetadataTab';
import type { Author, FormDataType, Title } from './annotationSidebarFormTypes';
import {
  AnnotationMetadataProvider,
  type AnnotationMetadataContextValue,
} from './contexts/AnnotationMetadataContext';
import type { AnnotationSidebarTab } from './annotationSidebarTab';
import { useDocument } from './contexts';
import { hasAnyReviewerChange } from './reviewerChanges';
import { sanityFindingsTooltip } from './SanityCheckWarningContent';

export type { Title, Author, FormDataType } from './annotationSidebarFormTypes';
export type { AnnotationSidebarTab } from './annotationSidebarTab';

interface OutlineSegmentRowProps {
  seg: TextSegment;
  displayIndex: number;
  isActive: boolean;
  onNavigate: (segmentId: string) => void;
}

const OutlineSegmentRow = memo(function OutlineSegmentRow({
  seg,
  displayIndex,
  isActive,
  onNavigate,
}: OutlineSegmentRowProps) {
  const { t } = useTranslation();
  const { sanityFindingsBySegmentId, textContent, isReadOnly } = useDocument();
  const findings = sanityFindingsBySegmentId.get(seg.id);
  const hasFindings = Boolean(findings && findings.length > 0);
  const hasBlockerFinding = Boolean(findings?.some((finding) => finding.severity === 'blocker'));
  const preview =
    seg.title ? seg.title : seg.text.length > 80 ? `${seg.text.slice(0, 80)}...` : seg.text;
  const showMetaRow = Boolean(seg.label || seg.title || seg.author);
  const isApproved = seg.status === 'approved'
  const isChecked = seg.status === 'checked'
  const isRejected = seg.status === 'rejected'
  return (
    <button
      type="button"
      onClick={() => onNavigate(seg.id)}
      className={` w-full text-left px-3 py-2.5 rounded-md transition-colors cursor-pointer ${
        isActive ? 'bg-blue-50 border border-blue-300' : 'hover:bg-gray-50 border border-transparent'
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 text-xs font-medium mt-0.5 w-6 h-6 rounded-full flex items-center justify-center ${
            isApproved
              ? 'bg-blue-600 text-white'
              : isChecked
                ? 'bg-green-600 text-white'
                : isRejected
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 text-gray-600'
          }`}
     
        >
          {displayIndex + 1}
        </span>
        {hasFindings && findings && (
          <span title={sanityFindingsTooltip(findings, t, textContent)} className="shrink-0 mt-0.5">
            <AlertCircle className={`h-4 w-4 ${hasBlockerFinding ? 'text-red-500' : 'text-amber-500'}`} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm leading-snug font-monlam ${
              isActive ? 'text-blue-900' : 'text-gray-700'
            } ${isApproved && !isReadOnly ? 'opacity-50' : ''}`}
          >
            {preview}
          </p>
          {showMetaRow ? (
            <div className="flex flex-wrap gap-2 mt-2 items-center justify-between">
              {seg.author ? (
                <span
                  className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-violet-50 border border-violet-200 text-violet-900 text-xs font-semibold"
                  title={t('outliner.annotation.authorBadge')}
                >
                  <User /> <span> {seg.author}</span>
                </span>
              ) : (
                <div />
              )}
              {seg.label ? (
                <span
                  className=" inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-xs"
                  title={t('outliner.annotation.labelBadge')}
                >
                  {t(segmentLabelI18nKey(seg.label))}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
});

interface AnnotationSidebarProps {
  activeSegment: TextSegment | undefined;
  listRef: React.RefObject<ListImperativeAPI | null>;
  documentId?: string;
  segments?: TextSegment[];
  onSegmentClick?: (segmentId: string) => void;
  /** Fired when the sidebar Title field value changes (for UI that must reflect unsaved title text). */
  onTitleDraftChange?: (name: string) => void;
  sidebarActiveTab: AnnotationSidebarTab;
  onSidebarActiveTabChange: (tab: AnnotationSidebarTab) => void;
}

interface PendingChanges {
  segmentId: string;
  title?: Title;
  author?: Author;
}

export type DocTextSpan = { start: number; end: number };

export interface AnnotationSidebarRef {
  setTitleValueWithoutUpdate: (value: string, docSpan?: DocTextSpan | null) => void;
  setAuthorValueWithoutUpdate: (value: string, docSpan?: DocTextSpan | null) => void;
  getPendingChanges: () => PendingChanges[];
  isDirty: () => boolean;
  save: () => Promise<void>;
  resetDirtyState: () => void;
}

const AnnotationSidebarInner = forwardRef<AnnotationSidebarRef, AnnotationSidebarProps>(({
  activeSegment,
  listRef,
  documentId,
  segments = [],
  onSegmentClick,
  onTitleDraftChange,
  sidebarActiveTab,
  onSidebarActiveTabChange,
}, ref) => {
  const { t } = useTranslation();
  const { isReadOnly: isDocumentReadOnly } = useDocument();
  const { updateSegment: updateSegmentMutation, document } = useOutlinerDocument();
  const activeSegmentId = activeSegment?.id || null;
  const fullDocumentContent = document?.content ?? '';
  const titleSourceSpanRef = useRef<DocTextSpan | null>(null);
  const authorSourceSpanRef = useRef<DocTextSpan | null>(null);
  /** Last title/author strings applied by AI detect (for updated_* on save). Cleared when segment id changes or bubble selects text. */
  const aiBaselineTitleRef = useRef<string | null>(null);
  const aiBaselineAuthorRef = useRef<string | null>(null);
  const loadedSegmentIdRef = useRef<string | null>(null);
  const title = activeSegment?.title || '';
  const author = activeSegment?.author || '';


  const emptyAuthor = (): Author => ({ id: '', name: '', bdrc_id: '' });

  // Form data that resets when segment changes
  const [formData, setFormData] = useState<FormDataType>({
    title: { name: title, bdrc_id: '' },
    author: { id: '', name: author, bdrc_id: '' },
  });
  // Track pending changes per segment
  const pendingChangesRef = useRef<Map<string, FormDataType>>(new Map());
  
  // Track if form has been modified (dirty state)
  const [isDirtyState, setIsDirtyState] = useState(false);
  const originalFormDataRef = useRef<FormDataType>({
    title: { name: '', bdrc_id: '' },
    author: emptyAuthor(),
  });

  // Local state for "title supplied by annotator" checkbox; only persisted on save
  const [suppliedTitleChecked, setSuppliedTitleChecked] = useState(false);

  // Reset formData and is_supplied_title checkbox when segment changes
  useEffect(() => {
    if (!activeSegment) {
      onTitleDraftChange?.('');
      return;
    }
    if (loadedSegmentIdRef.current !== activeSegment.id) {
      loadedSegmentIdRef.current = activeSegment.id;
      aiBaselineTitleRef.current = null;
      aiBaselineAuthorRef.current = null;
    }
    const initialFormData = {
      title: { name: title, bdrc_id: activeSegment.title_bdrc_id || '' },
      author: {
        id: '',
        name: author,
        bdrc_id: activeSegment.author_bdrc_id || '',
      },
    };
    setFormData(initialFormData);
    originalFormDataRef.current = initialFormData;
    setIsDirtyState(false);
    setSuppliedTitleChecked(activeSegment.is_supplied_title ?? false);
    titleSourceSpanRef.current =
      activeSegment.title_span_start != null && activeSegment.title_span_end != null
        ? { start: activeSegment.title_span_start, end: activeSegment.title_span_end }
        : null;
    authorSourceSpanRef.current =
      activeSegment.author_span_start != null && activeSegment.author_span_end != null
        ? { start: activeSegment.author_span_start, end: activeSegment.author_span_end }
        : null;
    onTitleDraftChange?.(initialFormData.title.name);
  }, [activeSegment, title, author, onTitleDraftChange]);

  const handleSuppliedTitleChange = useCallback((checked: boolean) => {
    if (checked) {
      titleSourceSpanRef.current = null;
      aiBaselineTitleRef.current = null;
    }
    setSuppliedTitleChecked(checked);
  }, []);

 



  // Check if form data differs from original
  const checkDirtyState = useCallback((newFormData: FormDataType) => {
    const titleChanged = newFormData.title.name !== originalFormDataRef.current.title.name ||
                         newFormData.title.bdrc_id !== originalFormDataRef.current.title.bdrc_id;
    const authorChanged = newFormData.author.name !== originalFormDataRef.current.author.name ||
                          newFormData.author.bdrc_id !== originalFormDataRef.current.author.bdrc_id;
    setIsDirtyState(titleChanged || authorChanged);
  }, []);

  // Handle title update
  const handleTitleUpdate = useCallback((value: string) => {
    onTitleDraftChange?.(value);
    setFormData(prev => {
      const updatedTitle: Title = { ...prev.title, name: value };
      const updated = { ...prev, title: updatedTitle };
      if (activeSegmentId) {
        const current = pendingChangesRef.current.get(activeSegmentId) || prev;
        pendingChangesRef.current.set(activeSegmentId, { ...current, title: updatedTitle });
      }
      checkDirtyState(updated);
      return updated;
    });
  }, [activeSegmentId, checkDirtyState, onTitleDraftChange]);

  // Handle author update
  const handleAuthorUpdate = useCallback((value: string) => {
    setFormData(prev => {
      const updatedAuthor: Author = { ...prev.author, id: prev.author.id ?? '', name: value };
      const updated = { ...prev, author: updatedAuthor };
      if (activeSegmentId) {
        const current = pendingChangesRef.current.get(activeSegmentId) || prev;
        pendingChangesRef.current.set(activeSegmentId, { ...current, author: updatedAuthor });
      }
      checkDirtyState(updated);
      return updated;
    });
  }, [activeSegmentId, checkDirtyState]);


  const applyAISuggestion = useCallback(
    (field: 'title' | 'author', value: string) => {
      if (!activeSegment?.text || !activeSegmentId) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      const segmentText = activeSegment.text;
      const segStart = activeSegment.span_start ?? 0;
      const span = findPhraseDocSpan(segmentText, segStart, trimmed);
      if (field === 'title') {
        titleSourceSpanRef.current = span;
        aiBaselineTitleRef.current = trimmed;
        handleTitleUpdate(trimmed);
      } else {
        authorSourceSpanRef.current = span;
        aiBaselineAuthorRef.current = trimmed;
        handleAuthorUpdate(trimmed);
      }
    },
    [activeSegment, activeSegmentId, handleTitleUpdate, handleAuthorUpdate]
  );

  // AI suggestions hook (detection only; applying suggestions is explicit via onApplyAISuggestion)
  const aiSuggestions = useAISuggestions({
    activeSegment,
    activeSegmentId,
  });

  const aiSuggestionsControls = useMemo(
    () => ({
      ...aiSuggestions,
      onApplyAISuggestion: applyAISuggestion,
    }),
    [aiSuggestions, applyAISuggestion]
  );

  const [reviewerApplyField, setReviewerApplyField] = useState<'title' | 'author' | null>(null);

  // A rejected segment comes back for the annotator to fix: the reviewer's title/author is a
  // suggestion they can apply (kept on the rejection, since reject clears the segment's copy).
  // Otherwise the reviewer corrected it themselves and it is final, so it is only shown.
  const isRejectedSegment = activeSegment?.status === 'rejected';
  const reviewerTitleSource = isRejectedSegment
    ? activeSegment?.rejection?.reviewer_title
    : activeSegment?.reviewer_title;
  const reviewerAuthorSource = isRejectedSegment
    ? activeSegment?.rejection?.reviewer_author
    : activeSegment?.reviewer_author;

  const applyReviewerTitle = useCallback(async () => {
    if (!activeSegment?.text || !activeSegmentId || !isRejectedSegment) return;
    const raw = reviewerTitleSource;
    if (raw === null || raw === undefined) return;
    const trimmed = raw.trim();
    const isExplicitEmpty = trimmed === '';
    if (!trimmed && !isExplicitEmpty) return;
    setReviewerApplyField('title');
    try {
      const segmentText = activeSegment.text;
      const segStart = activeSegment.span_start ?? 0;
      const titleValue = trimmed;
      const span = isExplicitEmpty
        ? null
        : findPhraseDocSpan(segmentText, segStart, trimmed);
      const payload: SegmentUpdateRequest = {
        title: titleValue,
        reviewer_title: null,
      };
      if (isExplicitEmpty) {
        payload.title_span_start = null;
        payload.title_span_end = null;
        payload.updated_title = null;
      } else if (span) {
        payload.title_span_start = span.start;
        payload.title_span_end = span.end;
        const sourceSlice = fullDocumentContent.slice(span.start, span.end);
        payload.updated_title = trimmed !== sourceSlice ? trimmed : null;
      } else {
        payload.title_span_start = null;
        payload.title_span_end = null;
        const inSegment = activeSegment.text.includes(trimmed);
        payload.updated_title = !inSegment ? trimmed : null;
      }
      await updateSegmentMutation(activeSegmentId, payload);
      handleTitleUpdate(titleValue);
      titleSourceSpanRef.current = span ?? null;
      aiBaselineTitleRef.current = null;
      toast.success(t('outliner.reviewerSuggestion.appliedTitle'));
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : t('outliner.annotation.toastSaveFailed'));
    } finally {
      setReviewerApplyField(null);
    }
  }, [
    activeSegment,
    activeSegmentId,
    isRejectedSegment,
    reviewerTitleSource,
    fullDocumentContent,
    handleTitleUpdate,
    t,
    updateSegmentMutation,
  ]);

  const applyReviewerAuthor = useCallback(async () => {
    if (!activeSegment?.text || !activeSegmentId || !isRejectedSegment) return;
    const raw = reviewerAuthorSource;
    if (raw === null || raw === undefined) return;
    const trimmed = raw.trim();
    const isExplicitEmpty = trimmed === '';
    if (!trimmed && !isExplicitEmpty) return;
    setReviewerApplyField('author');
    try {
      const segmentText = activeSegment.text;
      const segStart = activeSegment.span_start ?? 0;
      const authorValue = trimmed;
      const span = isExplicitEmpty
        ? null
        : findPhraseDocSpan(segmentText, segStart, trimmed);
      const payload: SegmentUpdateRequest = {
        author: authorValue,
        reviewer_author: null,
      };
      if (isExplicitEmpty) {
        payload.author_span_start = null;
        payload.author_span_end = null;
        payload.updated_author = null;
      } else if (span) {
        payload.author_span_start = span.start;
        payload.author_span_end = span.end;
        const sourceSlice = fullDocumentContent.slice(span.start, span.end);
        payload.updated_author = trimmed !== sourceSlice ? trimmed : null;
      } else {
        payload.author_span_start = null;
        payload.author_span_end = null;
        const inSegment = activeSegment.text.includes(trimmed);
        payload.updated_author = !inSegment ? trimmed : null;
      }
      await updateSegmentMutation(activeSegmentId, payload);
      handleAuthorUpdate(authorValue);
      authorSourceSpanRef.current = span ?? null;
      aiBaselineAuthorRef.current = null;
      toast.success(t('outliner.reviewerSuggestion.appliedAuthor'));
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : t('outliner.annotation.toastSaveFailed'));
    } finally {
      setReviewerApplyField(null);
    }
  }, [
    activeSegment,
    activeSegmentId,
    isRejectedSegment,
    reviewerAuthorSource,
    fullDocumentContent,
    handleAuthorUpdate,
    t,
    updateSegmentMutation,
  ]);

  const reviewerSuggestionControls = useMemo(
    () => ({
      reviewerTitle: reviewerTitleSource,
      reviewerAuthor: reviewerAuthorSource,
      readOnly: !isRejectedSegment,
      applyingField: reviewerApplyField,
      onApplyReviewerTitle: applyReviewerTitle,
      onApplyReviewerAuthor: applyReviewerAuthor,
    }),
    [
      reviewerTitleSource,
      reviewerAuthorSource,
      isRejectedSegment,
      reviewerApplyField,
      applyReviewerTitle,
      applyReviewerAuthor,
    ]
  );

  const onSave = useCallback(async () => {
    // Validate that we have an active segment
    if (!activeSegment || !activeSegmentId) {
      toast.error(t('outliner.annotation.toastNoSegment'));
      return;
    }

    // Validate form data
    const titleName = formData.title?.name?.trim() || '';
    const authorName = formData.author?.name?.trim() || '';

    if (!titleName) {
      toast.error(t('outliner.annotation.toastNeedTitleOrAuthor'));
      return;
    }

    const updatePayload: SegmentUpdateRequest = {
      status: 'checked',
    };

    if (titleName || titleName==='') {
      updatePayload.title = titleName;
      if (formData.title?.bdrc_id) {
        updatePayload.title_bdrc_id = formData.title.bdrc_id;
      }
      updatePayload.is_supplied_title = suppliedTitleChecked;
      const tspan = titleSourceSpanRef.current;
      const aiTitleBase = aiBaselineTitleRef.current?.trim() ?? null;
      if (tspan) {
        updatePayload.title_span_start = tspan.start;
        updatePayload.title_span_end = tspan.end;
      } else {
        updatePayload.title_span_start = null;
        updatePayload.title_span_end = null;
      }
      if (aiTitleBase !== null) {
        updatePayload.updated_title = titleName.trim() !== aiTitleBase ? titleName : null;
      } else if (tspan) {
        const sourceSlice = fullDocumentContent.slice(tspan.start, tspan.end);
        updatePayload.updated_title = titleName !== sourceSlice ? titleName : null;
      } else {
        const inSegment = activeSegment.text.includes(titleName.trim());
        updatePayload.updated_title = !inSegment ? titleName : null;
      }
    }

    if (authorName || authorName==='') {
      updatePayload.author = authorName;
      if (formData.author?.bdrc_id) {
        updatePayload.author_bdrc_id = formData.author.bdrc_id;
      }
      const aspan = authorSourceSpanRef.current;
      const aiAuthorBase = aiBaselineAuthorRef.current?.trim() ?? null;
      if (aspan) {
        updatePayload.author_span_start = aspan.start;
        updatePayload.author_span_end = aspan.end;
      } else {
        updatePayload.author_span_start = null;
        updatePayload.author_span_end = null;
      }
      if (aiAuthorBase !== null) {
        updatePayload.updated_author = authorName.trim() !== aiAuthorBase ? authorName : null;
      } else if (aspan) {
        const sourceSlice = fullDocumentContent.slice(aspan.start, aspan.end);
        updatePayload.updated_author = authorName !== sourceSlice ? authorName : null;
      } else {
        const inSegment = activeSegment.text.includes(authorName.trim());
        updatePayload.updated_author = !inSegment ? authorName : null;
      }
    }
    // Make API call to update segment using mutation
    try {
      await updateSegmentMutation(activeSegmentId, updatePayload);
      if (titleName) {
        aiBaselineTitleRef.current = titleName.trim();
      }
      if (authorName) {
        aiBaselineAuthorRef.current = authorName.trim();
      }
      toast.success(t('outliner.annotation.toastSaved'));
      // Clear pending changes for this segment
      if (pendingChangesRef.current.has(activeSegmentId)) {
        pendingChangesRef.current.delete(activeSegmentId);
      }
      // Reset dirty state after successful save
      setIsDirtyState(false);
      originalFormDataRef.current = { ...formData };
      onSidebarActiveTabChange('outlines');
    } catch (error) {
      console.error('Failed to save annotations:', error);
      toast.error(error instanceof Error ? error.message : t('outliner.annotation.toastSaveFailed'));
    }
  }, [
    activeSegment,
    activeSegmentId,
    formData,
    suppliedTitleChecked,
    updateSegmentMutation,
    fullDocumentContent,
    t,
    onSidebarActiveTabChange,
  ]);

  const resetMetadataForm = useCallback(() => {
    onTitleDraftChange?.('');
    setFormData({
      title: { name: '', bdrc_id: '' },
      author: { id: '', name: '', bdrc_id: '' },
    });
    setIsDirtyState(false);
  }, [onTitleDraftChange]);

  const handleMetadataFormUpdate = useCallback(
    (field: 'title' | 'author', value: Title | Author) => {
      if (field === 'title') {
        const v = value as Title;
        onTitleDraftChange?.(v.name);
        setFormData(prev => {
          const updated = { ...prev, title: v };
          if (activeSegmentId) {
            const current = pendingChangesRef.current.get(activeSegmentId) || prev;
            pendingChangesRef.current.set(activeSegmentId, { ...current, title: v });
          }
          checkDirtyState(updated);
          return updated;
        });
      } else {
        const v = value as Author;
        setFormData(prev => {
          const author: Author = { ...v, id: v.id ?? '' };
          const updated = { ...prev, author };
          if (activeSegmentId) {
            const current = pendingChangesRef.current.get(activeSegmentId) || prev;
            pendingChangesRef.current.set(activeSegmentId, { ...current, author });
          }
          checkDirtyState(updated);
          return updated;
        });
      }
    },
    [activeSegmentId, checkDirtyState, onTitleDraftChange]
  );

  const handleAnnotationsReset = useCallback(async () => {
    // Re-enable edit mode without erasing the saved title/author values.
    if (!activeSegmentId) return;
    await updateSegmentMutation(activeSegmentId, {
      status: 'unchecked',
    });
  }, [activeSegmentId, updateSegmentMutation]);

  const handleNotApplicable = useCallback(async () => {
    aiBaselineTitleRef.current = null;
    aiBaselineAuthorRef.current = null;
    if (!activeSegmentId) return;
    try {
      await updateSegmentMutation(activeSegmentId, {
        title: '',
        author: '',
        title_bdrc_id: '',
        author_bdrc_id: '',
        title_span_start: null,
        title_span_end: null,
        updated_title: null,
        author_span_start: null,
        author_span_end: null,
        updated_author: null,
        reviewer_title: null,
        reviewer_author: null,
        status: 'checked',
      });
      onSidebarActiveTabChange('outlines');
    } catch (error) {
      console.error('Failed to mark segment as not applicable:', error);
      toast.error(error instanceof Error ? error.message : t('outliner.annotation.toastSaveFailed'));
    }
  }, [activeSegmentId, updateSegmentMutation, onSidebarActiveTabChange, t]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    setTitleValueWithoutUpdate: (value: string, docSpan?: DocTextSpan | null) => {
      onTitleDraftChange?.(value);
      if (docSpan !== undefined) {
        titleSourceSpanRef.current = docSpan;
        if (docSpan != null) {
          aiBaselineTitleRef.current = null;
        }
      }
      setFormData(prev => {
        const updatedTitle: Title = { ...prev.title, name: value };
        const updated = { ...prev, title: updatedTitle };
        if (activeSegmentId) {
          const current = pendingChangesRef.current.get(activeSegmentId) || prev;
          pendingChangesRef.current.set(activeSegmentId, { ...current, title: updatedTitle });
        }
        checkDirtyState(updated);
        return updated;
      });
    },
    setAuthorValueWithoutUpdate: (value: string, docSpan?: DocTextSpan | null) => {
      if (docSpan !== undefined) {
        authorSourceSpanRef.current = docSpan;
        if (docSpan != null) {
          aiBaselineAuthorRef.current = null;
        }
      }
      setFormData(prev => {
        const updatedAuthor: Author = { ...prev.author, id: prev.author.id ?? '', name: value };
        const updated = { ...prev, author: updatedAuthor };
        if (activeSegmentId) {
          const current = pendingChangesRef.current.get(activeSegmentId) || prev;
          pendingChangesRef.current.set(activeSegmentId, { ...current, author: updatedAuthor });
        }
        checkDirtyState(updated);
        return updated;
      });
    },
    getPendingChanges: () => {
      const changes: PendingChanges[] = [];
      pendingChangesRef.current.forEach((data, segmentId) => {
        changes.push({
          segmentId,
          title: data.title,
          author: data.author,
        });
      });
      return changes;
    },
    isDirty: () => isDirtyState,
    save: async () => {
      await onSave();
    },
    resetDirtyState: () => {
      setIsDirtyState(false);
      if (activeSegment) {
        originalFormDataRef.current = { ...formData };
      }
    },
  }), [isDirtyState, onSave, activeSegment, formData, activeSegmentId, checkDirtyState, onTitleDraftChange]);

 


  const segmentIndexById = useMemo(() => {
    const map = new Map<string, number>();
    segments.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [segments]);

  const handleToClick = useCallback(
    (segmentId: string) => {
      onSegmentClick?.(segmentId);
      const index = segmentIndexById.get(segmentId) ?? -1;
      if (index < 0) return;
      listRef.current?.scrollToRow({
        align: 'start',
        behavior: 'auto',
        index,
      });
    },
    [onSegmentClick, segmentIndexById, listRef]
  );

  const hasLabelledSegment = Boolean(activeSegment?.label);
  // Approved segments keep the tab closed while the document is being worked on; in an approved
  // document opened read-only, it opens view-only so the reviewer's title/author corrections show.
  const isMetadataDisabled =
    !activeSegment ||
    !hasLabelledSegment ||
    (activeSegment.status === 'approved' && !isDocumentReadOnly);
  

  const [labelFilter, setLabelFilter] = useState<LabelFilterValue[]>([]);
  const [completionFilter, setCompletionFilter] = useState<CompletionFilterValue>('all');
  const [reviewerChangedOnly, setReviewerChangedOnly] = useState(false);

  const filteredSegments = useMemo(() => {
    let list = segments;
    if (labelFilter.length > 0) {
      const set = new Set(labelFilter);
      list = list.filter((seg) =>
        seg.label ? set.has(seg.label) : set.has('none')
      );
    }
    if (completionFilter === 'completed') {
      list = list.filter((seg) => seg.status === 'checked');
    } else if (completionFilter === 'not_completed') {
      list = list.filter((seg) => seg.status !== 'checked');
    }
    if (reviewerChangedOnly) {
      list = list.filter(hasAnyReviewerChange);
    }
    return list;
  }, [segments, labelFilter, completionFilter, reviewerChangedOnly]);

  useEffect(() => {
    if (isMetadataDisabled && sidebarActiveTab === 'metadata') {
      onSidebarActiveTabChange('outlines');
    }
  }, [isMetadataDisabled, sidebarActiveTab, onSidebarActiveTabChange]);

  const metadataContextValue = useMemo((): AnnotationMetadataContextValue | null => {
    if (!activeSegment) return null;
    return {
      activeSegment,
      documentId,
      isMetadataTabSelected: sidebarActiveTab === 'metadata',
      aiSuggestionsControls,
      reviewerSuggestionControls,
      formData,
      suppliedTitleChecked,
      activeSegmentId: activeSegment.id,
      onFormFieldUpdate: handleMetadataFormUpdate,
      resetForm: resetMetadataForm,
      onSuppliedTitleChange: handleSuppliedTitleChange,
      onSave,
      onNotApplicable: handleNotApplicable,
      onResetAnnotations: handleAnnotationsReset,
      isDocumentReadOnly,
    };
  }, [
    isDocumentReadOnly,
    activeSegment,
    documentId,
    sidebarActiveTab,
    aiSuggestionsControls,
    reviewerSuggestionControls,
    formData,
    suppliedTitleChecked,
    handleMetadataFormUpdate,
    resetMetadataForm,
    handleSuppliedTitleChange,
    onSave,
    handleNotApplicable,
    handleAnnotationsReset,
  ]);

  return (
    <div className="h-full min-h-0 w-full bg-white flex flex-col font-monlam-2 border-r-2 border-gray-200">
      <Tabs
        value={sidebarActiveTab}
        onValueChange={(v) => onSidebarActiveTabChange(v as AnnotationSidebarTab)}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <TabsList className="w-full shrink-0 border-b border-gray-200 rounded-none">
          <TabsTrigger value="outlines">{t('outliner.annotation.tabOutlines')}</TabsTrigger>
          <span
            title={isMetadataDisabled ? t('outliner.annotation.metadataDisabledHint') : undefined}
            className={`flex-1 flex ${isMetadataDisabled ? 'inline-flex ' : undefined}`}
          >
            <TabsTrigger value="metadata" disabled={isMetadataDisabled}>
              {t('outliner.annotation.tabMetadata')}
            </TabsTrigger>
          </span>
        </TabsList>

      

        <TabsContent value="outlines" className="flex-1 overflow-auto">
          <div className="space-y-1">
            <FilterSegments
              value={labelFilter}
              onChange={setLabelFilter}
              completionFilter={completionFilter}
              onCompletionFilterChange={setCompletionFilter}
              reviewerChangedOnly={reviewerChangedOnly}
              onReviewerChangedOnlyChange={setReviewerChangedOnly}
            />

            <div className=" px-2 py-2">

            {filteredSegments.length === 0 ? (
              <div className="text-center text-gray-500 py-12">
                <p className="text-sm">
                  {segments.length === 0 ? t('outliner.annotation.noSegments') : t('outliner.annotation.noMatchingFilters')}
                </p>
              </div>
            ) : (
              filteredSegments.map((seg, index) => (
                <OutlineSegmentRow
                  key={seg.id}
                  seg={seg}
                  // Real segment number, so filtered rows match the numbers in the workspace.
                  displayIndex={segmentIndexById.get(seg.id) ?? index}
                  isActive={seg.id === activeSegmentId}
                  onNavigate={handleToClick}
                />
              ))
            )}
            </div>

          </div>
        </TabsContent>
        <TabsContent value="metadata" className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {!activeSegment ? (
            <div className="text-center text-gray-500 py-12">
              <p>{t('outliner.annotation.noSegmentSelected')}</p>
              <p className="text-sm mt-2">{t('outliner.annotation.clickSegmentToAnnotate')}</p>
            </div>
          ) : (
            <AnnotationMetadataProvider value={metadataContextValue!}>
              <AnnotationMetadataTab />
            </AnnotationMetadataProvider>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
});

AnnotationSidebarInner.displayName = 'AnnotationSidebar';

export const AnnotationSidebar = memo(AnnotationSidebarInner);