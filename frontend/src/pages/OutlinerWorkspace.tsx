import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { UnsavedChangesDialog } from '@/components/outliner/UnsavedChangesDialog';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useOutlinerDocument } from '@/hooks/useOutlinerDocument'
import { useAITextEndings } from '@/hooks/useAITextEndings'
import {
  outlinerSegmentToTextSegment,
  checkDocumentSanity,
  type SanityCheckSegmentInput,
  type SanityCheckFinding,
} from '@/api/outliner'
import type {
  TextSegment,
  BubbleMenuState,
  CursorPosition,
} from '@/components/outliner'
import {
  AnnotationSidebar,
  type AnnotationSidebarRef,
  type AnnotationSidebarTab,
} from '@/components/outliner/AnnotationSidebar';
import { Workspace } from '@/components/outliner/Workspace';
import { flashSegmentRange } from '@/components/outliner/utils/flashSegmentRange';
import {
  DocumentProvider,
  SelectionProvider,
  CursorProvider,
  ActionsProvider,
} from '@/components/outliner/contexts'
import { useListRef } from 'react-window';
import { SplitPane, Pane } from 'react-split-pane';

function getSelectionOffsetsInRoot(
  root: HTMLElement,
  range: Range
): { start: number; end: number } | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const preStart = document.createRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);
  const preEnd = document.createRange();
  preEnd.selectNodeContents(root);
  preEnd.setEnd(range.endContainer, range.endOffset);
  return { start: preStart.toString().length, end: preEnd.toString().length };
}

/** Stand-ins for editing actions while an approved document is open read-only. */
const noop = () => {};
const noopAsync = async () => {};

const OutlinerWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Get activeSegmentId from URL
  const activeSegmentId = searchParams.get('segmentId');
  // Backend integration hook
  const {
    document: outlinerDocument,
    documentId,
    textContent: currentTextContent,
    segments: backendSegments,
    isLoading: isLoadingDocument,
    isSaving,
    error: loadError,
    refetchDocument,
    segmentLoadingStates,
    updateSegment: updateSegmentBackend,
    splitSegment: splitSegmentBackend,
    mergeSegments: mergeSegmentsBackend,
    resetSegments: resetSegmentsBackend,
    createSegmentsBulk: createSegmentsBulkBackend,
  } = useOutlinerDocument()

  // Approved documents open for reading only (the backend refuses changes too) — unless the
  // reviewer has sent a segment back, in which case the annotator fixes it as before.
  const isReadOnly =
    outlinerDocument?.status === 'approved' &&
    !outlinerDocument.segments?.some((segment) => segment.status === 'rejected')

  // Convert OutlinerSegment[] to TextSegment[]
  const currentSegments: TextSegment[] = useMemo(
    () => backendSegments.map((s) => outlinerSegmentToTextSegment(s, currentTextContent)),
    [backendSegments, currentTextContent]
  )

  // On-demand segmentation sanity check (top toolbar button + per-segment alert icons share
  // this one result so they never disagree; it's not run automatically on every edit).
  const sanityCheckSegments: SanityCheckSegmentInput[] = useMemo(
    () =>
      currentSegments
        .filter((segment) => typeof segment.span_start === 'number' && typeof segment.span_end === 'number')
        .map((segment) => ({
          id: segment.id,
          start: segment.span_start as number,
          end: segment.span_end as number,
          label: segment.label ?? null,
        })),
    [currentSegments]
  )

  const sanityQuery = useQuery({
    queryKey: ['outliner-document-sanity-check', documentId],
    queryFn: ({ signal }) => checkDocumentSanity(documentId!, sanityCheckSegments, signal),
    enabled: false,
    retry: 1,
  })

  const sanityReport = sanityQuery.data ?? null

  const sanityFindingsBySegmentId = useMemo(() => {
    const map = new Map<string, SanityCheckFinding[]>()
    for (const finding of sanityReport?.findings ?? []) {
      const existing = map.get(finding.segment_id)
      if (existing) {
        existing.push(finding)
      } else {
        map.set(finding.segment_id, [finding])
      }
    }
    return map
  }, [sanityReport])

  const sanityQueryRefetch = sanityQuery.refetch
  const handleCheckSanity = useCallback(() => {
    if (documentId) {
      sanityQueryRefetch()
    }
  }, [documentId, sanityQueryRefetch])


  const [expandedSegmentIds, setExpandedSegmentIds] = useState<string[]>([]);

  useEffect(() => {
    if (!activeSegmentId) return;
    setExpandedSegmentIds((prev) => {
      if (prev.includes(activeSegmentId)) return prev;
      return [...prev, activeSegmentId];
    });
  }, [activeSegmentId]);

  const toggleSegmentExpanded = useCallback(
    (segmentId: string) => {
      if (currentSegments.length === 1) return;
      setExpandedSegmentIds((prev) =>
        prev.includes(segmentId)
          ? prev.filter((id) => id !== segmentId)
          : [...prev, segmentId]
      );
    },
    [currentSegments.length]
  );

  const expandAllSegments = useCallback(() => {
    setExpandedSegmentIds(currentSegments.map((s) => s.id));
  }, [currentSegments]);

  const collapseAllSegments = useCallback(() => {
    if (activeSegmentId && currentSegments.some((s) => s.id === activeSegmentId)) {
      setExpandedSegmentIds([activeSegmentId]);
    } else {
      setExpandedSegmentIds([]);
    }
  }, [activeSegmentId, currentSegments]);

  const isAllSegmentsExpanded = useMemo(() => {
    if (currentSegments.length === 0) return false;
    if (currentSegments.length === 1) return true;
    const expanded = new Set(expandedSegmentIds);
    return currentSegments.every((s) => expanded.has(s.id));
  }, [currentSegments, expandedSegmentIds]);

  const toggleExpandAllSegments = useCallback(() => {
    if (isAllSegmentsExpanded) {
      collapseAllSegments();
    } else {
      expandAllSegments();
    }
  }, [isAllSegmentsExpanded, collapseAllSegments, expandAllSegments]);

  // Set active segment to the first segment when none is selected or the URL points to a replaced segment.
  useEffect(() => {
    if (
      currentSegments.length > 0 &&
      (!activeSegmentId || !currentSegments.some((segment) => segment.id === activeSegmentId))
    ) {
      setSearchParams({ segmentId: currentSegments[0].id }, { replace: true });
    }
  }, [currentSegments, activeSegmentId, setSearchParams]);
  
  // UI state for menus
  const [bubbleMenuState, setBubbleMenuState] = useState<BubbleMenuState | null>(null);
  const bubbleMenuStateRef = useRef<BubbleMenuState | null>(null);
  useEffect(() => {
    bubbleMenuStateRef.current = bubbleMenuState;
  }, [bubbleMenuState]);
 
  const [cursorPosition, setCursorPosition] = useState<CursorPosition | null>(null);
  
  // Store pending bubble menu value to apply when segment becomes active
  const pendingBubbleMenuValueRef = useRef<{
    field: 'title' | 'author';
    segmentId: string;
    text: string;
    docSpan?: { start: number; end: number };
  } | null>(null);

  // Unsaved changes dialog state
  const [unsavedChangesDialog, setUnsavedChangesDialog] = useState<{
    open: boolean;
    pendingSegmentId: string | null;
  }>({ open: false, pendingSegmentId: null });

  // AI text ending detection hook
  const aiTextEndingAbortControllerRef = useRef<AbortController | null>(null);
  const aiTextEndings = useAITextEndings({
    documentId: documentId || undefined,
    onSuccess: () => {
      // Success handling is done via query invalidation
    },
    onError: (error) => {
      console.error('Error detecting text endings:', error);
    },
  });

  // Get active segment
  const activeSegment = currentSegments.find((seg) => seg.id === activeSegmentId) as TextSegment;

  // Apply pending bubble menu value after segment becomes active (runs after child form reset in AnnotationSidebar)
  useEffect(() => {
    const pending = pendingBubbleMenuValueRef.current;
    if (!pending || activeSegmentId !== pending.segmentId) return;
    const { field, text, docSpan } = pending;
    if (field === 'title') {
      annotationSidebarRef.current?.setTitleValueWithoutUpdate(text, docSpan);
    } else if (field === 'author') {
      annotationSidebarRef.current?.setAuthorValueWithoutUpdate(text, docSpan);
    }
    pendingBubbleMenuValueRef.current = null;
  }, [activeSegmentId]);

  // Handle text selection in workspace
  const handleTextSelection = useCallback(() => {
    const selection = globalThis.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setBubbleMenuState(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const segmentTextEl =
      common.nodeType === Node.TEXT_NODE
        ? common.parentElement?.closest('.segment-text-content')
        : (common as Element).closest?.('.segment-text-content');

    const selectedText = selection.toString().trim();
    const hasTextSelection = selectedText.length > 0;

    if (!segmentTextEl) {
      setBubbleMenuState(null);
      setCursorPosition(null);
      return;
    }

    const targetSegmentId = segmentTextEl.getAttribute('data-segment-id');
    const targetSegmentElement = segmentTextEl.closest('[data-segment-container-id]');

    if (!targetSegmentId || !targetSegmentElement) {
      setBubbleMenuState(null);
      setCursorPosition(null);
      return;
    }

    // If text is selected, show bubble menu (title/author) and hide split menu
    if (hasTextSelection) {
      // Get selection range
      const rect = range.getBoundingClientRect();
      const segmentContainer = targetSegmentElement as HTMLElement;
      const segmentRect = segmentContainer.getBoundingClientRect();
        const menuWidth = 150; // Bubble menu width
        const menuHeight = 100; // Approximate bubble menu height
        const gap = 8; // Gap between selection and menu
        const padding = 8;
        const viewportHeight = window.innerHeight;

        // Calculate initial position below selection, relative to segment container
        const menuPosition = {
          x: rect.left - segmentRect.left - menuWidth / 2 + rect.width / 2,
          y: rect.bottom - segmentRect.top + gap, // 8px gap below selection
        };

        // Convert to viewport coordinates to check boundaries
        const viewportY = segmentRect.top + menuPosition.y;

        // Check if menu would overflow below viewport
        let adjustedY = menuPosition.y;
        if (viewportY + menuHeight + padding > viewportHeight) {
          // Position above selection instead
          adjustedY = rect.top - segmentRect.top - menuHeight - gap;
        }

        // Ensure menu stays within segment bounds horizontally (with padding)
        let adjustedX = menuPosition.x;
        if (adjustedX < padding) {
          adjustedX = padding;
        }
        if (adjustedX + menuWidth > segmentRect.width - padding) {
          adjustedX = segmentRect.width - menuWidth - padding;
        }

        // Final viewport check: ensure menu doesn't go off-screen vertically
        const finalViewportY = segmentRect.top + adjustedY;
        if (finalViewportY < padding) {
          adjustedY = padding - segmentRect.top;
        }
        if (finalViewportY + menuHeight > viewportHeight - padding) {
          adjustedY = viewportHeight - padding - menuHeight - segmentRect.top;
        }

        const contentEl = segmentTextEl as HTMLDivElement
        let selectionStartOffset = 0
        if (contentEl.contains(range.commonAncestorContainer)) {
          const preRange = range.cloneRange()
          preRange.selectNodeContents(contentEl)
          preRange.setEnd(range.startContainer, range.startOffset)
          selectionStartOffset = preRange.toString().length
        }

        setBubbleMenuState({
          segmentId: targetSegmentId,
          position: { x: adjustedX, y: adjustedY },
          selectedText: selectedText,
          selectionRange: range.cloneRange(),
          selectionStartOffset,
        });
        setCursorPosition(null); // Hide split menu
    } else {
      // No text selected, hide bubble menu
      setBubbleMenuState(null);
    }
  }, []);

  // Handle segment click - update URL (with unsaved changes check)
  const handleSegmentClick = useCallback((segmentId: string, event?: React.MouseEvent) => {
    // If clicking the same segment, do nothing special
    if (segmentId === activeSegmentId) {
      setBubbleMenuState(null);
      if (!event || !(event.target as HTMLElement).closest('.segment-text-content')) {
        setCursorPosition(null);
      }
      return;
    }

    // Check if there are unsaved changes
    if (annotationSidebarRef.current?.isDirty()) {
      setUnsavedChangesDialog({ open: true, pendingSegmentId: segmentId });
      return;
    }

    setSearchParams({ segmentId }, { replace: true });
    setBubbleMenuState(null);
    if (!event || !(event.target as HTMLElement).closest('.segment-text-content')) {
      setCursorPosition(null);
    }
  }, [setSearchParams, activeSegmentId]);

  // Handle unsaved changes dialog actions
  const handleUnsavedChangesSave = useCallback(async () => {
    await annotationSidebarRef.current?.save();
    const pendingSegmentId = unsavedChangesDialog.pendingSegmentId;
    setUnsavedChangesDialog({ open: false, pendingSegmentId: null });
    if (pendingSegmentId) {
      setSearchParams({ segmentId: pendingSegmentId }, { replace: true });
    }
  }, [unsavedChangesDialog.pendingSegmentId, setSearchParams]);

  const handleUnsavedChangesDiscard = useCallback(() => {
    annotationSidebarRef.current?.resetDirtyState();
    const pendingSegmentId = unsavedChangesDialog.pendingSegmentId;
    setUnsavedChangesDialog({ open: false, pendingSegmentId: null });
    if (pendingSegmentId) {
      setSearchParams({ segmentId: pendingSegmentId }, { replace: true });
    }
  }, [unsavedChangesDialog.pendingSegmentId, setSearchParams]);

  const handleUnsavedChangesCancel = useCallback(() => {
    setUnsavedChangesDialog({ open: false, pendingSegmentId: null });
  }, []);

  const handleActivateSegment = useCallback(
    (segmentId: string) => {
      if (segmentId !== activeSegmentId) {
        setSearchParams({ segmentId }, { replace: true });
      }
    },
    [activeSegmentId, setSearchParams]
  );

  // Handle cursor position change in contentEditable
  const handleCursorChange = useCallback((segmentId: string, element: HTMLDivElement) => {
    const selection = globalThis.getSelection();
    
    // If no selection exists, try to create one at the end of the element
    let range: Range;
    if (!selection || selection.rangeCount === 0) {
      // Create a range at the end of the element
      range = document.createRange();
      const textNode = element.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const textLength = textNode.textContent?.length || 0;
        range.setStart(textNode, textLength);
        range.setEnd(textNode, textLength);
      } else {
        // If no text node, set at the element itself
        range.setStart(element, 0);
        range.setEnd(element, 0);
      }
      // Set the selection
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      range = selection.getRangeAt(0);
    }

    // Check if selection is within this segment/content
    if (!element.contains(range.commonAncestorContainer)) return;

    // Check if there's text selected - if yes, don't show split menu
    const selectedText = selection?.toString().trim() || '';
    if (selectedText.length > 0) {
      // Text is selected, don't show split menu (bubble menu will be shown by handleTextSelection)
      setCursorPosition(null);
      return;
    }
    // Calculate character offset
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const offset = preCaretRange.toString().length;

    // Get cursor position relative to the segment container
    let cursorRect = range.getBoundingClientRect();
    const segmentContainer = element.closest('[data-segment-container-id]') as HTMLElement;

    if (!segmentContainer) return;

    // When there's no text, collapsed range often returns zero-size rect at (0,0).
    // Use the content element's rect so the menu appears at the start of the content area.
    const hasNoSize = cursorRect.width === 0 && cursorRect.height === 0;
    if (hasNoSize) {
      const contentRect = element.getBoundingClientRect();
      const lineHeight = Math.max(contentRect.height, 20);
      cursorRect = {
        left: contentRect.left,
        top: contentRect.top,
        right: contentRect.right,
        bottom: contentRect.top + lineHeight,
        width: contentRect.width,
        height: lineHeight,
        x: contentRect.x,
        y: contentRect.y,
        toJSON: () => ({}),
      } as DOMRect;
    }

    const segmentRect = segmentContainer.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = 50; // Approximate menu height
    const gap = 8; // Gap between cursor and menu
    const padding = 8;
    const viewportHeight = window.innerHeight;

    // Calculate initial position below cursor, relative to segment container
    // Position menu at cursor's left edge (aligned with cursor position)
    const menuPosition = {
      x: cursorRect.left - segmentRect.left,
      y: cursorRect.height > 0 
        ? cursorRect.bottom - segmentRect.top + gap
        : gap, // 8px gap below cursor
    };

    // Convert to viewport coordinates to check boundaries
    const viewportY = segmentRect.top + menuPosition.y;

    // Check if menu would overflow below viewport
    let adjustedY = menuPosition.y;
    if (viewportY + menuHeight + padding > viewportHeight) {
      // Position above cursor instead
      adjustedY = cursorRect.height > 0 
        ? cursorRect.top - segmentRect.top - menuHeight - gap
        : -menuHeight - gap;
    }

    // Ensure menu stays within segment bounds horizontally (with padding)
    let adjustedX = menuPosition.x;
    if (adjustedX < padding) {
      adjustedX = padding;
    }
    if (adjustedX + menuWidth > segmentRect.width - padding) {
      adjustedX = segmentRect.width - menuWidth - padding;
    }

    // Final viewport check: ensure menu doesn't go off-screen vertically
    const finalViewportY = segmentRect.top + adjustedY;
    if (finalViewportY < padding) {
      adjustedY = padding - segmentRect.top;
    }
    if (finalViewportY + menuHeight > viewportHeight - padding) {
      adjustedY = viewportHeight - padding - menuHeight - segmentRect.top;
    }

    // Show split menu and hide bubble menu when no text is selected
    setCursorPosition({ segmentId, offset, menuPosition: { x: adjustedX, y: adjustedY } });
    setBubbleMenuState(null);
  }, []);

  // Handle contentEditable input prevention
  const handleContentEditableInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Restore the original content
      const target = e.currentTarget;
      const segmentId = target.getAttribute('data-segment-id');
      if (segmentId === 'content-no-segments') {
        // Restore full text content when no segments
        setTimeout(() => {
          target.textContent = currentTextContent;
        }, 0);
      } else if (segmentId) {
        const segment = currentSegments.find((seg) => seg.id === segmentId);
        if (segment) {
          // Use setTimeout to restore after browser tries to update
          setTimeout(() => {
            target.textContent = segment.text;
          }, 0);
        }
      }
    },
    [currentSegments, currentTextContent]
  );
  
  // Handle contentEditable keydown to prevent content changes
  const handleContentEditableKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Allow navigation keys
    const allowedKeys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Tab',
      'Escape',
    ];

    // Allow Ctrl/Cmd combinations for navigation
    if (e.ctrlKey || e.metaKey) {
      if (['a', 'c', 'x', 'v'].includes(e.key.toLowerCase())) {
        // Allow select all, copy, cut, paste
        return;
      }
    }

    // Block all other keys that would modify content
    if (!allowedKeys.includes(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
    }
  }, []);

  // Handle attach parent button click for first segment
  const handleAttachParent = useCallback(async () => {
    if (currentSegments.length === 0) return;
    if (!documentId) return; // Only works with backend documents

    const firstSegment = currentSegments[0];
    const firstSegmentId = firstSegment.id;

    // Toggle is_attached: if already attached, set to false; otherwise set to true
    const newIsAttached = !(firstSegment.is_attached ?? false);

    try {
      await updateSegmentBackend(firstSegmentId, {
        is_attached: newIsAttached,
      });
    } catch (error) {
      console.error('Failed to update attachment status:', error);
    }
  }, [currentSegments, documentId, updateSegmentBackend]);

  // Handle segment status update (checked/unchecked)
  const handleSegmentStatusUpdate = useCallback(
    async (segmentId: string, status: 'checked' | 'unchecked') => {
      if (!documentId) return;
      try {
        await updateSegmentBackend(segmentId, {
          status,
        });
      } catch (error) {
        console.error('Failed to update segment status:', error);
      }
    },
    [documentId, updateSegmentBackend]
  );



  // Split segment at cursor position
  const handleSplitSegment =async ()=> {
    if (!cursorPosition || !documentId) return;

    if (cursorPosition.segmentId === 'content-no-segments') {
      const offset = cursorPosition.offset;
      // IMPORTANT: Do not trim/strip. Preserve whitespace/newlines exactly.
      const textBefore = currentTextContent.substring(0, offset);
      const textAfter = currentTextContent.substring(offset);

      // Don't split if either part would be empty
      if (textBefore.length === 0 || textAfter.length === 0) {
        return;
      }

      // Create segments using bulk create (with optimistic updates)
      try {
        const createdSegments = await createSegmentsBulkBackend([
          {
            segment_index: 0,
            span_start: 0,
            span_end: offset,
          },
          {
            segment_index: 1,
            span_start: offset,
            span_end: currentTextContent.length,
          },
        ]);
        setCursorPosition(null);
        // Set the first created segment as active
        if (createdSegments && createdSegments.length > 0) {
          setSearchParams({ segmentId: createdSegments[0].id }, { replace: true });
        }
        return;
      } catch (error) {
        console.error('Failed to create segments:', error);
        // Error toast is handled by the mutation
        return;
      }
    }

    if (!activeSegmentId) return;

    const segment = currentSegments.find((seg) => seg.id === cursorPosition.segmentId);
    if (!segment) return;

    const textBefore = segment.text.substring(0, cursorPosition.offset);
    const textAfter = segment.text.substring(cursorPosition.offset);

    if (textBefore.length === 0 || textAfter.length === 0) {
      return;
    }

    try {
      await splitSegmentBackend(cursorPosition.segmentId, cursorPosition.offset);
      return;
    } catch (error) {
      console.error('Failed to split segment:', error);
      return;
    }
  }
  // Merge segment with previous segment
  const handleMergeWithPrevious = useCallback(
    async (segmentId: string) => {
      const segmentIndex = currentSegments.findIndex((seg) => seg.id === segmentId);
      if (segmentIndex <= 0) {
        // Can't merge if it's the first segment or not found
        return;
      }

      const currentSegment = currentSegments[segmentIndex];
      const previousSegment = currentSegments[segmentIndex - 1];

      // Use backend merge
      if (documentId) {
        try {
          await mergeSegmentsBackend([previousSegment.id, currentSegment.id]);
          setCursorPosition(null);
          return;
        } catch (error) {
          console.error('Failed to merge segments:', error);
          return;
        }
      }
    },
    [currentSegments, documentId, mergeSegmentsBackend]
  );

  // Ref for AnnotationSidebar to access its methods
  const annotationSidebarRef = useRef<AnnotationSidebarRef>(null);
  const [annotationSidebarTab, setAnnotationSidebarTab] =
    useState<AnnotationSidebarTab>('outlines');

  // Handle bubble menu selection
  const handleBubbleMenuSelect = useCallback(
    (field: 'title' | 'author', segmentId: string, text: string) => {
      if (!segmentId || !text) return;

      const state = bubbleMenuStateRef.current;
      const seg = currentSegments.find(s => s.id === segmentId);
      let docSpan: { start: number; end: number } | undefined;
      if (
        state?.selectionRange &&
        seg != null &&
        seg.span_start != null &&
        state.segmentId === segmentId
      ) {
        const root = document.querySelector(
          `.segment-text-content[data-segment-id="${segmentId}"]`
        ) as HTMLElement | null;
        if (root) {
          const off = getSelectionOffsetsInRoot(root, state.selectionRange);
          if (off) {
            docSpan = { start: seg.span_start + off.start, end: seg.span_start + off.end };
          }
        }
      }

      if (activeSegmentId === segmentId) {
        pendingBubbleMenuValueRef.current = null;
        if (field === 'title') {
          annotationSidebarRef.current?.setTitleValueWithoutUpdate(text, docSpan);
        } else {
          annotationSidebarRef.current?.setAuthorValueWithoutUpdate(text, docSpan);
        }
      } else {
        pendingBubbleMenuValueRef.current = { field, segmentId, text, docSpan };
      }

      setSearchParams({ segmentId }, { replace: true });

      setBubbleMenuState(null);
      setAnnotationSidebarTab('metadata');
    },
    [setSearchParams, activeSegmentId, currentSegments]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (aiTextEndingAbortControllerRef.current) {
        aiTextEndingAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Browser beforeunload warning for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (annotationSidebarRef.current?.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

 
  const listRef= useListRef(null);

  /**
   * Selects a segment and brings it into view. The workspace list is virtualized, so an
   * off-screen row has no DOM node to scroll to and must go through the list API.
   *
   * With `range` (document-absolute, e.g. a finding's char span) the segment is expanded and
   * the flagged run itself is scrolled to and flashed, so the caller lands on the exact spot.
   */
  const handleNavigateToSegment = useCallback(
    (segmentId: string, range?: { start: number; end: number }) => {
      handleSegmentClick(segmentId);
      const index = currentSegments.findIndex((segment) => segment.id === segmentId);
      if (index < 0) return;

      // Reused by the flash below, which re-runs it until the row has mounted.
      const scrollRowIntoView = () =>
        listRef.current?.scrollToRow({ align: 'start', behavior: 'auto', index });
      scrollRowIntoView();

      const base = currentSegments[index].span_start;
      if (!range || base == null) return;
      // Collapsed rows render a truncated preview, so the range would have nothing to hit.
      setExpandedSegmentIds((prev) =>
        prev.includes(segmentId) ? prev : [...prev, segmentId]
      );
      flashSegmentRange(segmentId, range.start - base, range.end - base, {
        bringRowIntoView: scrollRowIntoView,
      });
    },
    [handleSegmentClick, currentSegments, listRef]
  );

  const cursorContextValue = useMemo(
    () => ({
      cursorPosition,
      setCursorPosition,
      // Read-only: no caret tracking, so the split menu never opens.
      onCursorChange: isReadOnly ? noop : handleCursorChange,
    }),
    [cursorPosition, handleCursorChange, isReadOnly]
  );

  const [sidebarTitleDraft, setSidebarTitleDraft] = useState('');
  const [activeSegmentSearchQuery, setActiveSegmentSearchQuery] = useState('');

  useEffect(() => {
    setActiveSegmentSearchQuery('');
  }, [activeSegmentId]);

  // AI outline: full-document TOC indices → replace segments (POST …/ai-outline)
  const handleAIDetectTextEndings = async (detector: 'rule' | 'mmbert') => {
    if (!documentId) return;

    if (aiTextEndingAbortControllerRef.current) {
      aiTextEndingAbortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    aiTextEndingAbortControllerRef.current = abortController;

    try {
      await aiTextEndings.runAiOutline({
        document_id: documentId,
        detector,
        signal: abortController.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('AI outline failed:', error);
      }
    } finally {
      if (!abortController.signal.aborted) {
        aiTextEndingAbortControllerRef.current = null;
      }
    }
  }

  // Stop AI text ending detection request
  const handleAITextEndingStop = useCallback(() => {
    if (aiTextEndingAbortControllerRef.current) {
      aiTextEndingAbortControllerRef.current.abort();
      aiTextEndingAbortControllerRef.current = null;
    }
    aiTextEndings.reset();
  }, [aiTextEndings]);

  // Undo AI text ending detection
  const handleUndoTextEndingDetection = useCallback(() => {
    // Note: Undo functionality should be handled by backend
    // For now, this is a placeholder
    console.warn('Undo functionality requires backend support');
  }, []);

 
  

  // Redirect to upload if no documentId
  if (!documentId) {
    navigate('/outliner');
    return null;
  }

  // Show error state when document fetch failed (e.g. network or API error in production)
  if (!isLoadingDocument && loadError) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-4">
          <p className="text-red-600 font-medium mb-2">{t('outliner.loadError.title')}</p>
          <p className="text-sm text-gray-600 mb-4">{loadError.message}</p>
          <button
            type="button"
            onClick={() => refetchDocument()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            {t('outliner.loadError.retry')}
          </button>
        </div>
      </div>
    );
  }
  const segmentsCount = currentSegments.length;
  const checkedSegmentsCount = currentSegments.filter(
    (segment) => segment.status === 'checked' || segment.status === 'approved'
  ).length
  const checked_percentage = segmentsCount > 0 ? (checkedSegmentsCount / segmentsCount) * 100 : 0;
  const rejectedSegmentsCount = currentSegments.filter((segment) => segment.status === 'rejected').length

  return (
    <DocumentProvider
      value={{
        textContent: currentTextContent,
        segments: currentSegments,
        checkedSegmentsCount,
        checked_percentage,
        rejectedSegmentsCount,
        segmentsCount,
        activeSegmentId,
        sidebarTitleDraft,
        activeSegmentSearchQuery,
        setActiveSegmentSearchQuery,
        aiTextEndingLoading: aiTextEndings.isLoading,
        segmentLoadingStates: segmentLoadingStates || new Map(),
        isUploading: isLoadingDocument || isSaving,
        sanityReport,
        sanityFindingsBySegmentId,
        isCheckingSanity: sanityQuery.isFetching,
        sanityCheckFailed: sanityQuery.isError,
        isReadOnly,
      }}
    >
      <SelectionProvider
        value={{
          bubbleMenuState,
          setBubbleMenuState,
          // Read-only: selecting text doesn't offer the title/author bubble.
          onTextSelection: isReadOnly ? noop : handleTextSelection,
          onBubbleMenuSelect: isReadOnly ? noop : handleBubbleMenuSelect,
        }}
      >
        <CursorProvider value={cursorContextValue}>
          <ActionsProvider
            value={{
              expandedSegmentIds,
              toggleSegmentExpanded,
              isAllSegmentsExpanded,
              toggleExpandAllSegments,
              onFileUpload: () => {},
              onFileUploadToBackend: undefined,
              onSegmentClick: handleSegmentClick,
              onActivate: handleActivateSegment,
              onInput: handleContentEditableInput,
              onKeyDown: handleContentEditableKeyDown,
              // Read-only: every action that changes the outline does nothing.
              onAttachParent: isReadOnly ? noopAsync : handleAttachParent,
              onMergeWithPrevious: isReadOnly ? noopAsync : handleMergeWithPrevious,
              onSplitSegment: isReadOnly ? noopAsync : handleSplitSegment,
              onAIDetectTextEndings: isReadOnly ? noopAsync : handleAIDetectTextEndings,
              onAITextEndingStop: handleAITextEndingStop,
              onUndoTextEndingDetection: isReadOnly ? noopAsync : handleUndoTextEndingDetection,
              onLoadNewFile: () => {},
              onSegmentStatusUpdate: isReadOnly ? noopAsync : handleSegmentStatusUpdate,
              onResetSegments: isReadOnly ? undefined : resetSegmentsBackend,
              onCheckSanity: handleCheckSanity,
              onNavigateToSegment: handleNavigateToSegment,
            }}
          >
            <div className="flex flex-col bg-gray-50" style={{ height: 'calc(100vh - 4rem)' }}>
              {/* Main Content */}
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <SplitPane
                  direction="horizontal"
                  className="outliner-split-pane min-h-0 min-w-0 flex-1"
                  dividerSize={8}
                >
                  <Pane defaultSize={384} minSize={240} maxSize="55%">
                    <AnnotationSidebar
                      ref={annotationSidebarRef}
                      listRef={listRef}
                      activeSegment={activeSegment}
                      documentId={documentId || undefined}
                      segments={currentSegments}
                      onSegmentClick={handleSegmentClick}
                      onTitleDraftChange={setSidebarTitleDraft}
                      sidebarActiveTab={annotationSidebarTab}
                      onSidebarActiveTabChange={setAnnotationSidebarTab}
                    />
                  </Pane>
                  <Pane minSize={320}>
                    <Workspace listRef={listRef} />
                  </Pane>
                </SplitPane>
              </div>

              {/* Unsaved Changes Dialog */}
              <UnsavedChangesDialog
                open={unsavedChangesDialog.open}
                onSave={handleUnsavedChangesSave}
                onDiscard={handleUnsavedChangesDiscard}
                onCancel={handleUnsavedChangesCancel}
              />
            </div>
          </ActionsProvider>
        </CursorProvider>
      </SelectionProvider>
    </DocumentProvider>
  )
};

export default OutlinerWorkspace;
