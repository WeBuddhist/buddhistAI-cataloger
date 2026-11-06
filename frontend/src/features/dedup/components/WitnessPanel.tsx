import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WitnessCard } from '../api/review';
import { selectionIn, useScrollToMark, type Marks, type Picked } from '../hooks/useCrossSelection';
import { useFullText } from '../hooks/useReview';
import { textEnds } from '../textPlace';
import { displayText, formatNumber } from '../utils';
import { WitnessMeta } from './SourceBadge';
import { MarkedText } from './TextSelection';

/** How far through `el`'s text a click landed, from 0 to 1. */
function clickedShare(el: HTMLElement): number | null {
  const selection = window.getSelection();
  const length = el.textContent?.length ?? 0;
  if (!selection?.anchorNode || !el.contains(selection.anchorNode) || length === 0) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(selection.anchorNode, selection.anchorOffset);
  return before.toString().length / length;
}

// Older items carry `head` / `tail` (~220 characters each); newer ones do not, so theirs
// come from the full text, which is otherwise fetched when asked for.
export default function WitnessPanel({
  tag,
  card,
  onShowScans,
  onPointAt,
  marks,
  onSelect,
}: Readonly<{
  tag: 'A' | 'B';
  card: WitnessCard;
  onShowScans?: () => void;
  /** A click in the full text: how far through it, to bring the scans there. */
  onPointAt?: (share: number) => void;
  /** A selection, or the matches of one on the other side, to mark in the full text. */
  marks?: Marks;
  onSelect?: (side: 'A' | 'B', picked: Picked | null) => void;
}>) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  // A match can be anywhere in the text, not only in the opening and ending shown here.
  const expanded = opened || Boolean(marks?.ranges.length);
  const scrollRef = useScrollToMark(marks?.ranges[marks.active]?.start, Boolean(marks?.follow));
  const full = useFullText(card.mw_id, expanded || !card.head);
  const ends = full.data ? textEnds(full.data.text_bo) : null;
  const head = card.head ?? ends?.head ?? '';
  const tail = card.tail ?? ends?.tail ?? '';
  const length = card.text_length ?? 0;
  const unseen = Math.max(0, length - head.length - tail.length);
  // Opening the note form takes the browser's selection away, so the words stay marked here.
  const excerpt = (text: string) => {
    const shown = displayText(text);
    const at = marks?.quote ? shown.indexOf(marks.quote) : -1;
    const ranges = at < 0 ? [] : [{ start: at, end: at + marks!.quote!.length }];
    return <MarkedText text={shown} marks={{ ranges, active: 0 }} />;
  };

  return (
    <section data-side={tag} className="flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="border-b border-gray-200 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-100 text-sm font-semibold text-gray-600">
            {tag}
          </span>
          <div className="min-w-0">
            <h2 className="break-words font-monlam text-lg leading-relaxed text-gray-900 sm:text-xl">
              {card.title_bo || <span className="font-sans text-sm italic text-gray-400">{t('dedup.witness.noTitle')}</span>}
            </h2>
            {card.author_name_bo ? (
              <div className="font-monlam text-base text-gray-700">{card.author_name_bo}</div>
            ) : (
              <div className="text-sm italic text-gray-400">{t('dedup.witness.noAuthor')}</div>
            )}
          </div>
        </div>
        <div className="mt-3">
          <WitnessMeta card={card} onShowScans={onShowScans} />
        </div>
      </header>

      {expanded ? (
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-gray-400">{t('dedup.witness.fullText')}</span>
            <ToggleButton
              onClick={() => {
                setOpened(false);
                onSelect?.(tag, null);
              }}
            >
              <ChevronUp className="h-3.5 w-3.5" /> {t('dedup.witness.showLess')}
            </ToggleButton>
          </div>
          {full.isLoading && <div className="py-8 text-center text-sm text-gray-500">{t('dedup.witness.loadingFullText')}</div>}
          {full.error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>{t('dedup.witness.fullTextUnavailable')}</strong> {full.error.message}
            </div>
          )}
          {full.data && (
            <div
              ref={scrollRef}
              onPointerUp={(e) => onSelect?.(tag, selectionIn(e.currentTarget))}
              onClick={(e) => {
                const share = clickedShare(e.currentTarget);
                if (share != null) onPointAt?.(share);
              }}
              className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap break-words pr-2 font-monlam text-lg leading-loose sm:text-xl text-gray-900"
            >
              <MarkedText text={displayText(full.data.text_bo)} marks={marks ?? { ranges: [], active: 0 }} />
            </div>
          )}
        </div>
      ) : (
        <div
          // Only the words here: this is the opening and ending, not a place in the full text.
          onPointerUp={(e) => {
            const picked = selectionIn(e.currentTarget);
            onSelect?.(tag, picked && { text: picked.text });
          }}
          className="whitespace-pre-wrap break-words px-4 py-4 font-monlam text-lg leading-loose text-gray-900 sm:px-5 sm:py-5 sm:text-xl"
        >
          <div className="mb-1 font-sans text-[11px] uppercase tracking-wide text-gray-400">{t('dedup.witness.opening')}</div>
          {head ? excerpt(head) : <span className="font-sans text-sm italic text-gray-400">{t('dedup.witness.noText')}</span>}

          {unseen > 0 && (
            <div className="my-4 flex items-center gap-3 font-sans">
              <span className="h-px flex-1 bg-gray-200" />
              <ToggleButton onClick={() => setOpened(true)}>
                <ChevronDown className="h-3.5 w-3.5" /> {t('dedup.witness.showFullText')}
                <span className="hidden text-gray-400 sm:inline">
                  · {t('dedup.witness.moreCharacters', { n: formatNumber(unseen) })}
                </span>
              </ToggleButton>
              <span className="h-px flex-1 bg-gray-200" />
            </div>
          )}

          {tail && (
            <>
              <div className="mb-1 font-sans text-[11px] uppercase tracking-wide text-gray-400">{t('dedup.witness.ending')}</div>
              {excerpt(tail)}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ToggleButton({ onClick, children }: Readonly<{ onClick: () => void; children: React.ReactNode }>) {
  return (
    <button
      onClick={onClick}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-300 bg-white px-3 py-1 font-sans text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
    >
      {children}
    </button>
  );
}
