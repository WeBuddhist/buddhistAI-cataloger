import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAnnotationMetadata } from '../contexts/AnnotationMetadataContext';

/** Levenshtein distance. */
function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  const row = Array.from({ length: bn + 1 }, (_, i) => i);
  for (let i = 1; i <= an; i++) {
    let prev = i;
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = next;
    }
    row[bn] = prev;
  }
  return row[bn];
}

/** Match percentage 0–100 between two strings (1 - normalized Levenshtein). */
function getMatchPercentage(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 100;
  const maxLen = Math.max(a.length, b.length, 1);
  const distance = levenshtein(a.trim(), b.trim());
  const ratio = 1 - distance / maxLen;
  return Math.round(Math.max(0, Math.min(100, ratio * 100)));
}

function getMatchIndicatorClass(pct: number | null): string {
  if (pct === null) return '';
  if (pct >= 80) return 'bg-green-100 text-green-800 border-green-200';
  if (pct >= 40) return 'bg-amber-100 text-amber-800 border-amber-200';
  if (pct > 0) return 'bg-orange-100 text-orange-800 border-orange-200';
  return 'bg-red-100 text-red-800 border-red-200';
}

export type AuthorFieldProps = {
  disabled?: boolean;
};

export const AuthorField = ({ disabled: disabledFromParent }: AuthorFieldProps = {}) => {
  const { t } = useTranslation();
  const {
    activeSegment: segment,
    formData,
    onFormFieldUpdate: onUpdate,
    aiSuggestionsControls,
    reviewerSuggestionControls,
    isDocumentReadOnly,
  } = useAnnotationMetadata();
  const disabled =
    segment.status === 'checked' || isDocumentReadOnly || Boolean(disabledFromParent);
  const authorSearch = formData?.author?.name || '';
  const setAuthorSearch = (value: string) => {
    onUpdate('author', { name: value, bdrc_id: '' });
  };
  const inputRef = useRef<HTMLInputElement | null>(null);

  const bdrcId = formData?.author?.bdrc_id || segment.author_bdrc_id || '';

  /** Name of the BDRC result when user selected it (for match % display). */
  const [selectedAuthorName, setSelectedAuthorName] = useState<string | null>(null);

 

  useEffect(() => {
    setSelectedAuthorName(null);
  }, [segment?.id]);
  useEffect(() => {
    if (!bdrcId) setSelectedAuthorName(null);
  }, [bdrcId]);

  const matchPercentage =
    bdrcId && selectedAuthorName && authorSearch.trim()
      ? getMatchPercentage(authorSearch.trim(), selectedAuthorName)
      : null;

  const matchIndicatorClass = getMatchIndicatorClass(matchPercentage);

  const ai = aiSuggestionsControls.aiSuggestions;
  const authorSuggestion =
    (ai?.author?.trim() || ai?.suggested_author?.trim() || '').trim();
  const showAuthorSuggestion =
    !disabled &&
    !aiSuggestionsControls.aiLoading &&
    authorSuggestion.length > 0 &&
    authorSuggestion !== authorSearch.trim();
  // The AI answered but found no author: say so, so it doesn't look like the tool skipped it.
  const showNoAuthorFound =
    !disabled &&
    ai != null &&
    !aiSuggestionsControls.aiLoading &&
    authorSuggestion.length === 0 &&
    !authorSearch.trim();

  const rawReviewerAuthor = reviewerSuggestionControls.reviewerAuthor;
  const hasReviewerAuthorSuggestion =
    rawReviewerAuthor !== null && rawReviewerAuthor !== undefined;
  const reviewerAuthorTrimmed = (rawReviewerAuthor ?? '').trim();
  const showReviewerAuthorSuggestion =
    hasReviewerAuthorSuggestion &&
    (reviewerAuthorTrimmed.length > 0
      ? reviewerAuthorTrimmed !== authorSearch.trim()
      : true);

  return (
    <div>
      <div className="relative flex items-center gap-2">
      <Label htmlFor="author" className="mb-2">{t('outliner.authorField.label')}</Label>
      {matchPercentage !== null &&  authorSearch!=="Difficult to identify" && (
        <div
          className={`mb-1 h-full inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${matchIndicatorClass}`}
          title={t('outliner.authorField.matchBdrcTitle')}
        >
          {t('outliner.authorField.matchedPercent', { pct: matchPercentage })}
        </div>
      )}
        </div>
      <Input
        ref={inputRef}
        id="author"
        value={authorSearch}
        onChange={(e) => setAuthorSearch(e.target.value)}
        placeholder={t('outliner.authorField.placeholder')}
        className="w-full"
        disabled={disabled}
      />
      {showAuthorSuggestion ? (
        <div className="mt-2 flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">{t('outliner.aiDetect.suggestionLabelAuthor')}</span>
          <button
            type="button"
            className="w-full text-left rounded-lg border border-violet-200 bg-violet-50/90 px-2.5 py-1.5 text-sm font-monlam text-violet-950 shadow-sm transition hover:bg-violet-100 hover:border-violet-300"
            onClick={() => aiSuggestionsControls.onApplyAISuggestion('author', authorSuggestion)}
          >
            {authorSuggestion}
          </button>
        </div>
      ) : null}
      {showNoAuthorFound ? (
        <p className="mt-1.5 text-xs italic text-gray-500">{t('outliner.aiSuggestions.noAuthorFound')}</p>
      ) : null}
      {showReviewerAuthorSuggestion && reviewerSuggestionControls.readOnly ? (
        <div className="mt-2 flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">{t('outliner.reviewerSuggestion.correctedAuthor')}</span>
          <div className="w-full rounded-lg border border-amber-200 bg-amber-50/90 px-2.5 py-1.5 text-sm font-monlam text-amber-950">
            {reviewerAuthorTrimmed || t('outliner.reviewerSuggestion.emptyDisplay')}
          </div>
        </div>
      ) : null}
      {showReviewerAuthorSuggestion && !reviewerSuggestionControls.readOnly ? (
        <div className="mt-2 flex flex-col gap-1 min-w-0">
          <span className="text-xs text-gray-500">{t('outliner.reviewerSuggestion.labelAuthor')}</span>
          <button
            type="button"
            disabled={reviewerSuggestionControls.applyingField === 'author'}
            className="w-full text-left rounded-lg border border-sky-200 bg-sky-50/90 px-2.5 py-1.5 text-sm font-monlam text-sky-950 shadow-sm transition hover:bg-sky-100 hover:border-sky-300 disabled:opacity-60"
            onClick={() => void reviewerSuggestionControls.onApplyReviewerAuthor()}
          >
            {reviewerAuthorTrimmed || t('outliner.reviewerSuggestion.emptyDisplay')}
          </button>
        </div>
      ) : null}
    </div>
  );
};
