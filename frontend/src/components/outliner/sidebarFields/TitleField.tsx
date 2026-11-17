import { useRef, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAnnotationMetadata } from '../contexts/AnnotationMetadataContext';
import { AISuggestionsBox } from '../AISuggestionsBox';

export interface TitleFieldRef {
  setValueWithoutUpdate: (value: string) => void;
  getValue: () => string;
}

export type TitleFieldProps = {
  disabled?: boolean;
};

export const TitleField = forwardRef<TitleFieldRef, TitleFieldProps>(function TitleField(
  { disabled: disabledFromParent },
  ref,
) {
  const { t } = useTranslation();
  const {
    formData,
    onFormFieldUpdate: onUpdate,
    suppliedTitleChecked,
    onSuppliedTitleChange,
    activeSegment,
    aiSuggestionsControls,
    reviewerSuggestionControls,
    isDocumentReadOnly,
  } = useAnnotationMetadata();
  const disabled =
    activeSegment.status === 'checked' || isDocumentReadOnly || Boolean(disabledFromParent);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Allow parent to set/get title value programmatically
  useImperativeHandle(ref, () => ({
    setValueWithoutUpdate: (value: string) => {
      if (inputRef.current) {
        inputRef.current.value = value;
      }
    },
    getValue: () => {
      return inputRef.current?.value || '';
    }
  }));

  const titleSearch = formData?.title?.name || '';

  const setTitleSearch = (value: string) => {
    onUpdate('title', { name: value, bdrc_id: formData?.title?.bdrc_id ?? '' });
  };

  const ai = aiSuggestionsControls.aiSuggestions;
  const titleSuggestion =
    (ai?.title?.trim() || ai?.suggested_title?.trim() || '').trim();
  const showTitleSuggestion =
    !disabled &&
    !aiSuggestionsControls.aiLoading &&
    titleSuggestion.length > 0 &&
    titleSuggestion !== titleSearch.trim();

  const rawReviewerTitle = reviewerSuggestionControls.reviewerTitle;
  const hasReviewerTitleSuggestion =
    rawReviewerTitle !== null && rawReviewerTitle !== undefined;
  const reviewerTitleTrimmed = (rawReviewerTitle ?? '').trim();
  const showReviewerTitleSuggestion =
    hasReviewerTitleSuggestion &&
    (reviewerTitleTrimmed.length > 0
      ? reviewerTitleTrimmed !== titleSearch.trim()
      : true);

  return (
    <div>
      <div className="flex items-center gap-2 justify-between">
        <Label htmlFor="title" className="">{t('outliner.titleField.label')}</Label>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="reconstructed-title"
            checked={suppliedTitleChecked}
            onChange={(e) => onSuppliedTitleChange(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <Label 
            htmlFor="reconstructed-title" 
            title={t('outliner.titleField.reconstructedHint')}
            className="text-sm text-gray-500 font-normal cursor-pointer"
          >
            {t('outliner.titleField.reconstructedCheckbox')}
          </Label>
          {activeSegment.status !== 'checked' && !isDocumentReadOnly && (
            <AISuggestionsBox
              loading={aiSuggestionsControls.aiLoading}
              onDetect={() => void aiSuggestionsControls.onAIDetect()}
              onStop={aiSuggestionsControls.onAIStop}
            />
          )}
        </div>
      </div>
      <Input
        ref={inputRef}
        id="title"
        value={titleSearch}
        onChange={(e) => setTitleSearch(e.target.value)}
        placeholder={suppliedTitleChecked ? t('outliner.titleField.placeholderReconstructed') : t('outliner.titleField.placeholder')}
        className="w-full"
        disabled={disabled}
      />
      {showTitleSuggestion ? (
        <div className="mt-2 flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">{t('outliner.aiDetect.suggestionLabelTitle')}</span>
          <button
            type="button"
            className="w-full text-left rounded-lg border border-violet-200 bg-violet-50/90 px-2.5 py-1.5 text-sm font-monlam text-violet-950 shadow-sm transition hover:bg-violet-100 hover:border-violet-300"
            onClick={() => aiSuggestionsControls.onApplyAISuggestion('title', titleSuggestion)}
          >
            {titleSuggestion}
          </button>
        </div>
      ) : null}
      {showReviewerTitleSuggestion && reviewerSuggestionControls.readOnly ? (
        <div className="mt-2 flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">{t('outliner.reviewerSuggestion.correctedTitle')}</span>
          <div className="w-full rounded-lg border border-amber-200 bg-amber-50/90 px-2.5 py-1.5 text-sm font-monlam text-amber-950">
            {reviewerTitleTrimmed || t('outliner.reviewerSuggestion.emptyDisplay')}
          </div>
        </div>
      ) : null}
      {showReviewerTitleSuggestion && !reviewerSuggestionControls.readOnly ? (
        <div className="mt-2 flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">{t('outliner.reviewerSuggestion.labelTitle')}</span>
          <button
            type="button"
            disabled={reviewerSuggestionControls.applyingField === 'title'}
            className="w-full text-left rounded-lg border border-sky-200 bg-sky-50/90 px-2.5 py-1.5 text-sm font-monlam text-sky-950 shadow-sm transition hover:bg-sky-100 hover:border-sky-300 disabled:opacity-60"
            onClick={() => void reviewerSuggestionControls.onApplyReviewerTitle()}
          >
            {reviewerTitleTrimmed || t('outliner.reviewerSuggestion.emptyDisplay')}
          </button>
        </div>
      ) : null}
    </div>
  );
});

TitleField.displayName = 'TitleField';

