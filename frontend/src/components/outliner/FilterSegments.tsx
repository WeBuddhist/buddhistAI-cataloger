import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X } from 'lucide-react';
import type { SegmentLabel } from './types';
import { SEGMENT_LABEL_VALUES, segmentLabelI18nKey } from './segment-label';
import { Button } from '@/components/ui/button';
import { Label } from "@/components/ui/label"

const radioClassName =
  'size-4 shrink-0 rounded-full border border-input text-primary accent-primary shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30'

export type LabelFilterValue = SegmentLabel | 'none';

/** Filter by completion: all, completed only (status === 'checked'), or not completed. */
export type CompletionFilterValue = 'all' | 'completed' | 'not_completed';

const SHOW_ALL_VALUE = 'all';

const LABEL_FILTER_VALUES: (typeof SHOW_ALL_VALUE | SegmentLabel)[] = [
  SHOW_ALL_VALUE,
  ...SEGMENT_LABEL_VALUES.filter((v): v is SegmentLabel => v !== 'none'),
];

const COMPLETION_OPTION_VALUES: CompletionFilterValue[] = [
  'all',
  'completed',
  'not_completed',
];

interface FilterSegmentsProps {
  /** Selected labels to show. Empty = show all segments. */
  readonly value: readonly LabelFilterValue[];
  readonly onChange: (value: LabelFilterValue[]) => void;
  /** Filter by completion status. */
  readonly completionFilter: CompletionFilterValue;
  readonly onCompletionFilterChange: (value: CompletionFilterValue) => void;
  /** Only segments the reviewer split/merged or added (same rule as the segment badges). */
  readonly reviewerChangedOnly: boolean;
  readonly onReviewerChangedOnlyChange: (value: boolean) => void;
}

export function FilterSegments({
  value,
  onChange,
  completionFilter,
  onCompletionFilterChange,
  reviewerChangedOnly,
  onReviewerChangedOnlyChange,
}: FilterSegmentsProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selectValue = value.length === 0 ? SHOW_ALL_VALUE : value[0];

  function handleSelect(val: string) {
    if (val === SHOW_ALL_VALUE) {
      onChange([]);
    } else {
      onChange([val as LabelFilterValue]);
    }
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-between px-0 h-8 font-medium text-gray-600 hover:text-gray-900"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="text-xs">{t('outliner.filter.filters')}</span>
        {isOpen ? (
          <X className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
      </Button>
      <div
        className={`absolute right-0 top-full z-10 mt-1 h-max overflow-hidden border border-gray-200 bg-white shadow-lg transition-[max-height,opacity] duration-300 ease-out ${
          isOpen ? 'h-max opacity-100' : 'max-h-0 opacity-0 pointer-events-none border-r-0 border-l-0 border-t-0'
        }`}
      >
        <div className="space-y-4 p-3 min-w-[200px]">
          <div>
            <p id="filter-label" className="text-xs font-medium text-gray-600 mb-2">{t('outliner.filter.label')}</p>
            <div role="radiogroup" aria-labelledby="filter-label" className="grid gap-3">
              {LABEL_FILTER_VALUES.map((optVal) => {
                const inputId = `label-filter-${optVal}`
                const label =
                  optVal === SHOW_ALL_VALUE
                    ? t('outliner.filter.showAll')
                    : t(segmentLabelI18nKey(optVal))
                return (
                  <div key={optVal} className="flex items-center gap-3">
                    <input
                      type="radio"
                      id={inputId}
                      name="segment-label-filter"
                      value={optVal}
                      checked={selectValue === optVal}
                      onChange={() => handleSelect(optVal)}
                      className={radioClassName}
                    />
                    <Label htmlFor={inputId} className="text-sm font-normal cursor-pointer text-gray-700 hover:text-gray-900">
                      {label}
                    </Label>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <p id="filter-completion" className="text-xs font-medium text-gray-600 mb-2">{t('outliner.filter.completion')}</p>
            <div role="radiogroup" aria-labelledby="filter-completion" className="grid gap-3">
              {COMPLETION_OPTION_VALUES.map((optVal) => {
                const inputId = `completion-filter-${optVal}`
                const completionLabel =
                  optVal === 'all'
                    ? t('outliner.filter.all')
                    : optVal === 'completed'
                      ? t('outliner.filter.completed')
                      : t('outliner.filter.notCompleted')
                return (
                  <div key={optVal} className="flex items-center gap-3">
                    <input
                      type="radio"
                      id={inputId}
                      name="segment-completion-filter"
                      value={optVal}
                      checked={completionFilter === optVal}
                      onChange={() => onCompletionFilterChange(optVal)}
                      className={radioClassName}
                    />
                    <Label htmlFor={inputId} className="text-sm font-normal cursor-pointer text-gray-700 hover:text-gray-900">
                      {completionLabel}
                    </Label>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">{t('outliner.filter.reviewer')}</p>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="reviewer-changed-filter"
                checked={reviewerChangedOnly}
                onChange={(e) => onReviewerChangedOnlyChange(e.target.checked)}
                className="size-4 shrink-0 rounded border border-input accent-primary"
              />
              <Label htmlFor="reviewer-changed-filter" className="text-sm font-normal cursor-pointer text-gray-700 hover:text-gray-900">
                {t('outliner.filter.reviewerChangedOnly')}
              </Label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
