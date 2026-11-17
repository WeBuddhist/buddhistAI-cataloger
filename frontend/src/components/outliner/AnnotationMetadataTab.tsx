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
  const prevDocumentIdRef = useRef(documentId);
  const onAIDetectRef = useRef(aiSuggestionsControls.onAIDetect);
  onAIDetectRef.current = aiSuggestionsControls.onAIDetect;
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
      return;
    }

    const justEnteredMetadataTab = !wasMetadataTabSelectedRef.current;
    if (!justEnteredMetadataTab) {
      return;
    }

    wasMetadataTabSelectedRef.current = true;

    const timeoutId = globalThis.setTimeout(() => {
      const { activeSegment: seg, formData: fd } = snapshotRef.current;
      if (!documentIdRef.current) return;
      // Read-only documents only show metadata; never fetch AI suggestions for them.
      if (isDocumentReadOnlyRef.current) return;
      if (seg.label !== 'TEXT' || seg.status === 'checked') return;
      if (!seg.text?.trim()) return;
      const titleEmpty = !seg.title?.trim() && !fd.title?.name?.trim();
      const authorEmpty = !seg.author?.trim() && !fd.author?.name?.trim();
      if (!titleEmpty || !authorEmpty) return;
      void onAIDetectRef.current();
    }, 0);

    return () => {
      globalThis.clearTimeout(timeoutId);
      wasMetadataTabSelectedRef.current = false;
    };
  }, [isMetadataTabSelected, documentId]);

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
