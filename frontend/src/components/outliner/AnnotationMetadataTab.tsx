import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { TitleField } from './sidebarFields/TitleField';
import { AuthorField } from './sidebarFields/AuthorField';
import { AISuggestionsBox } from './AISuggestionsBox';
import { SegmentSearchBar } from './SegmentSearchBar';
import { RotateCcw, Save, X } from 'lucide-react';
import { useAnnotationMetadata } from './contexts/AnnotationMetadataContext';
import { useDocument } from './contexts';
import { findAllOccurrences } from '@/features/outliner';

export type { AISuggestionsControls } from './contexts/AnnotationMetadataContext';

/**
 * Metadata tab for the annotation sidebar. Reads segment, form, AI controls, and actions from
 * `AnnotationMetadataProvider` (no long prop lists).
 */
export function AnnotationMetadataTab() {
  const { t } = useTranslation();
  const {
    activeSegment,
    documentId,
    isMetadataTabSelected,
    aiSuggestionsControls,
    formData,
    activeSegmentId,
    onSave,
    onNotApplicable,
    onResetAnnotations,
    isDocumentReadOnly,
  } = useAnnotationMetadata();

  const { activeSegmentSearchQuery, setActiveSegmentSearchQuery } = useDocument();

  const segmentSearchMatchCount = useMemo(
    () => findAllOccurrences(activeSegment.text, activeSegmentSearchQuery).length,
    [activeSegment.text, activeSegmentSearchQuery]
  );

  const isTextSegment = activeSegment.label === 'TEXT';

  const wasMetadataTabSelectedRef = useRef(false);
  /** Segment the auto-run last handled on this tab visit (null after leaving the tab). */
  const autoDetectedSegmentIdRef = useRef<string | null>(null);
  const prevDocumentIdRef = useRef(documentId);
  const onAIDetectRef = useRef(aiSuggestionsControls.onAIAutoDetect);
  onAIDetectRef.current = aiSuggestionsControls.onAIAutoDetect;
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;
  const snapshotRef = useRef({ activeSegment, formData });
  snapshotRef.current = { activeSegment, formData };
  const isDocumentReadOnlyRef = useRef(isDocumentReadOnly);
  isDocumentReadOnlyRef.current = isDocumentReadOnly;

  useEffect(() => {
    if (documentId !== prevDocumentIdRef.current) {
      wasMetadataTabSelectedRef.current = false;
      prevDocumentIdRef.current = documentId;
    }
  }, [documentId]);

  useEffect(() => {
    if (!isMetadataTabSelected) {
      wasMetadataTabSelectedRef.current = false;
      autoDetectedSegmentIdRef.current = null;
      return;
    }

    // Run on entering the Metadata tab, and again whenever another segment is opened on it.
    const justEnteredMetadataTab = !wasMetadataTabSelectedRef.current;
    if (!justEnteredMetadataTab && autoDetectedSegmentIdRef.current === activeSegment.id) {
      return;
    }
    // Right after switching segments the form still holds the previous segment's values for a
    // moment (the sidebar refills it in its own effect), so judge by the saved segment only.
    const trustForm = justEnteredMetadataTab;
    const previous = {
      entered: wasMetadataTabSelectedRef.current,
      segmentId: autoDetectedSegmentIdRef.current,
    };
    wasMetadataTabSelectedRef.current = true;
    autoDetectedSegmentIdRef.current = activeSegment.id;

    let fired = false;
    const timeoutId = globalThis.setTimeout(() => {
      fired = true;
      const { activeSegment: seg, formData: fd } = snapshotRef.current;
      if (!documentIdRef.current) return;
      // Read-only documents only show metadata; never fetch AI suggestions for them.
      if (isDocumentReadOnlyRef.current) return;
      if (seg.label !== 'TEXT' || seg.status === 'checked') return;
      if (!seg.text?.trim()) return;
      const titleEmpty = !seg.title?.trim() && !(trustForm && fd.title?.name?.trim());
      const authorEmpty = !seg.author?.trim() && !(trustForm && fd.author?.name?.trim());
      // One call asks for both. Also run when only one is missing: after a split the lower
      // segment already has an auto-filled title but no author. Asks at most once per segment
      // (see useAISuggestions); reopening it shows the remembered answer.
      if (!titleEmpty && !authorEmpty) return;
      void onAIDetectRef.current();
    }, 0);

    return () => {
      globalThis.clearTimeout(timeoutId);
      // Cancelled before it ran (e.g. React re-running effects): let the next run try again.
      if (!fired) {
        wasMetadataTabSelectedRef.current = previous.entered;
        autoDetectedSegmentIdRef.current = previous.segmentId;
      }
    };
  }, [isMetadataTabSelected, documentId, activeSegment.id]);

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full border-l-[3px] border-r-blue-500/85 pl-4 pr-2 py-3 shadow-[inset_4px_0_12px_-4px_rgba(59,130,246,0.12)]">
      <div className="overflow-y-auto flex-1 min-h-0 space-y-6">
        <div className="shrink-0 flex pl-0.5">
        
        <SegmentSearchBar
          segmentId={activeSegment.id}
          query={activeSegmentSearchQuery}
          onQueryChange={setActiveSegmentSearchQuery}
          matchCount={segmentSearchMatchCount}
        />
       
       
      </div>
     

        {isTextSegment ? (
          <div className="relative flex flex-col gap-4">
                        <TitleField />
                        <AuthorField />
          </div>
        ) : null}
        {/* Read-only documents: no Save / Not applicable / Reset. */}
        {!isDocumentReadOnly && (
        <div className="shrink-0 flex gap-2 bg-white pt-3 mt-2 border-t border-gray-100">
          {activeSegment.status !== 'checked' ? (
            <>
              {isTextSegment ? (
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => void onSave()}
                  variant="default"
                  disabled={
                    !activeSegmentId || !formData.title?.name?.trim()
                  }
                >
                  <Save />
                  {t('outliner.annotation.save')}
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => void onNotApplicable()}
                variant="outline"
                className="flex-1"
                disabled={!activeSegmentId}
              >
                <X /> {t('outliner.annotation.notApplicable')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={() => void onResetAnnotations()}
              variant="outline"
              disabled={!activeSegmentId}
              className="w-full"
            >
              <RotateCcw /> {t('outliner.annotation.reset')}
            </Button>
          )}
        </div>
        )}
      </div>

     
    </div>
  );
}
