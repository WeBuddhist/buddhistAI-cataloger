import { createContext, useContext, type ReactNode } from 'react';
import type { AISuggestions, TextSegment } from '../types';
import type { Author, FormDataType, Title } from '../annotationSidebarFormTypes';

/** Controls exposed from `useAISuggestions` for the metadata panel. */
export interface AISuggestionsControls {
  aiSuggestions: AISuggestions | null;
  aiLoading: boolean;
  onAIDetect: () => Promise<void>;
  /** Automatic run: asks once per segment; later visits show the remembered answer. */
  onAIAutoDetect: () => Promise<void>;
  onAIStop: () => void;
  /** Apply detected text to the title or author field (sets spans for save). */
  onApplyAISuggestion: (field: 'title' | 'author', value: string) => void;
}

/** Reviewer's title/author; applying persists to annotator fields and clears the suggestion. */
export interface ReviewerSuggestionControls {
  reviewerTitle?: string | null;
  reviewerAuthor?: string | null;
  /** True when the reviewer's value is a final correction (shown only); false on a rejected
   * segment, where it is a suggestion the annotator can apply. */
  readOnly: boolean;
  applyingField: 'title' | 'author' | null;
  onApplyReviewerTitle: () => Promise<void>;
  onApplyReviewerAuthor: () => Promise<void>;
}

export interface AnnotationMetadataContextValue {
  activeSegment: TextSegment;
  documentId?: string;
  /** True only when the annotation sidebar "Metadata" tab is selected (not when Outlines is active). */
  isMetadataTabSelected: boolean;
  aiSuggestionsControls: AISuggestionsControls;
  reviewerSuggestionControls: ReviewerSuggestionControls;
  formData: FormDataType;
  suppliedTitleChecked: boolean;
  activeSegmentId: string;
  onFormFieldUpdate: (field: 'title' | 'author', value: Title | Author) => void;
  resetForm: () => void;
  onSuppliedTitleChange: (checked: boolean) => void;
  onSave: () => Promise<void>;
  onNotApplicable: () => Promise<void>;
  onResetAnnotations: () => Promise<void>;
  /** Approved document open read-only: show the metadata, change nothing. */
  isDocumentReadOnly: boolean;
}

const AnnotationMetadataContext = createContext<AnnotationMetadataContextValue | null>(null);

export function AnnotationMetadataProvider({
  value,
  children,
}: {
  value: AnnotationMetadataContextValue;
  children: ReactNode;
}) {
  return (
    <AnnotationMetadataContext.Provider value={value}>{children}</AnnotationMetadataContext.Provider>
  );
}

export function useAnnotationMetadata(): AnnotationMetadataContextValue {
  const ctx = useContext(AnnotationMetadataContext);
  if (ctx == null) {
    throw new Error('useAnnotationMetadata must be used within AnnotationMetadataProvider');
  }
  return ctx;
}
