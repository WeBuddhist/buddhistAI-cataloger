import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Columns2, GitCompareArrows, Library } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PairEvidence as Evidence, WitnessCard } from '../api/review';
import { ONE_SIDE_SELECTION, noteSelectingSide, useCrossSelection, type Picked, type Tag } from '../hooks/useCrossSelection';
import { useFullText } from '../hooks/useReview';
import type { NewNote } from '../notes';
import type { FullTextView } from './FullTextDialog';
import ScanPanel, { type ScanPoint, type ScanTag } from './ScanPanel';
import AiAnalysis from './AiAnalysis';
import { SelectionBar } from './TextSelection';
import WitnessPanel from './WitnessPanel';
import { displayText, issueLabel, overlapNote, pct } from '../utils';

// The shared Button has no pointer cursor; added here to leave other features untouched.
const PTR = 'cursor-pointer';

// What a pair shows whoever looks at it: shared wording, the two texts, the scores.
// Used by the answer screens and the read-only shared page; `children` goes between the
// score strip and the texts (the adjudicator's "Annotator answers").
export default function PairEvidence({
  itemId,
  evidence: ev,
  cardA,
  cardB,
  onFullText,
  scan,
  onScanChange,
  bottomInset,
  children,
  afterTexts,
  onAddNote,
}: Readonly<{
  itemId: number;
  evidence: Evidence;
  cardA: WitnessCard;
  cardB: WitnessCard;
  onFullText: (view: FullTextView) => void;
  /** Whose scans are open beside the texts. Held by the page, which widens while they are. */
  scan: ScanTag | null;
  onScanChange: (tag: ScanTag | null) => void;
  /** Height of the docked action bar, so the scan panel stops above it. */
  bottomInset?: number;
  children?: ReactNode;
  /** Goes straight under the texts (the notes). */
  afterTexts?: ReactNode;
  /** Lets selected text get a note. Left out where notes cannot be written. */
  onAddNote?: (note: NewNote) => void;
}>) {
  const { t } = useTranslation();
  const closeScan = useCallback(() => onScanChange(null), [onScanChange]);
  const split = useSplit();
  // A click or selection in a text: open scans go to that place.
  const [pointAt, setPointAt] = useState<ScanPoint | null>(null);
  const scansFollow = (tag: ScanTag) => (share: number) => {
    if (!scan) return;
    onScanChange(tag);
    setPointAt({ tag, share });
  };
  // Selecting on either side searches the other's full text, fetched the first time.
  const [searching, setSearching] = useState(false);
  const fullA = useFullText(cardA.mw_id, searching).data?.text_bo;
  const fullB = useFullText(cardB.mw_id, searching).data?.text_bo;
  const shown = useMemo(() => ({ A: displayText(fullA ?? ''), B: displayText(fullB ?? '') }), [fullA, fullB]);
  const selection = useCrossSelection(shown);
  const { clear: clearSelection, select } = selection;
  useEffect(() => clearSelection(), [itemId, clearSelection]);
  const onSelect = (side: Tag, picked: Picked | null) => {
    if (picked) setSearching(true);
    select(side, picked);
  };
  const panel = (tag: Tag, card: typeof cardA) => (
    <WitnessPanel
      tag={tag}
      card={card}
      onShowScans={() => onScanChange(tag)}
      onPointAt={scansFollow(tag)}
      marks={selection.marksFor(tag)}
      onSelect={onSelect}
    />
  );
  const m = ev.metrics ?? {};
  // Same title, clearly different author: the author data cannot settle it.
  const authorConflict =
    m.title_lev != null && m.title_lev >= 0.95 && m.author_lev != null && m.author_lev < 0.5;
  return (
    <>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {m.jaccard != null ? (
            <div className="inline-flex min-w-0 items-center gap-3 rounded-md border border-gray-200 border-l-4 border-l-gray-800 bg-white px-4 py-2 shadow-sm">
              <span className="text-2xl font-semibold tabular-nums text-gray-900">{pct(m.jaccard)}</span>
              <span className="leading-tight">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {t('dedup.evidence.sharedWording')}
                </span>
                <span className="block text-sm text-gray-800">{overlapNote(m.jaccard)}</span>
              </span>
            </div>
          ) : (
            <span />
          )}
            <div className="flex w-full overflow-hidden rounded-md border border-violet-200 bg-violet-50 shadow-sm sm:inline-flex sm:w-auto">
            <button
              onClick={() => onFullText('side')}
              className={`${PTR} inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-3.5 py-2 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 sm:flex-none`}
            >
              <Columns2 className="h-4 w-4 shrink-0" /> <span className="sm:hidden">{t('dedup.evidence.fullTextsShort')}</span>
              <span className="hidden sm:inline">{t('dedup.evidence.compareFullTexts')}</span>
            </button>
            <span className="w-px bg-violet-200" />
            <button
              onClick={() => onFullText('diff')}
              className={`${PTR} inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-3.5 py-2 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 sm:flex-none`}
            >
              <GitCompareArrows className="h-4 w-4 shrink-0" /> <span className="sm:hidden">{t('dedup.evidence.differencesShort')}</span>
              <span className="hidden sm:inline">{t('dedup.evidence.showDifferences')}</span>
            </button>
            <span className="w-px bg-violet-200" />
            <button
              onClick={() => onFullText('volume')}
              className={`${PTR} inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-3.5 py-2 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 sm:flex-none`}
            >
              <Library className="h-4 w-4 shrink-0" /> {t('dedup.volume.tab')}
            </button>
          </div>
        </div>

        {/* BDRC's AI reading, there to help the annotator decide. */}
        {ev.llm_analysis && (
          <div className="mt-3">
            <AiAnalysis analysis={ev.llm_analysis} />
          </div>
        )}

        {children}

        {authorConflict && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <strong>{t('dedup.evidence.authorConflictTitle')}</strong>{' '}
            {t('dedup.evidence.authorConflictBody', {
              report: t('dedup.review.flagIssue'),
              issue: issueLabel('author_conflict'),
            })}
          </div>
        )}

        {/* With the scans open, the two texts stack on the left and the scans sit beside
            them; the divider between the two can be dragged. */}
        {scan ? (
          <div
            ref={split.ref}
            onPointerDownCapture={noteSelectingSide}
            className={`mt-4 grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,var(--split))_auto_minmax(0,1fr)] lg:gap-0 ${ONE_SIDE_SELECTION}`}
            style={{ '--split': `${split.pct}%` } as React.CSSProperties}
          >
            <div className="flex min-w-0 flex-col gap-4">
              {panel('A', cardA)}
              {panel('B', cardB)}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('dedup.scans.resize')}
              title={t('dedup.scans.resize')}
              onPointerDown={split.onPointerDown}
              onDoubleClick={split.reset}
              className="group hidden w-4 cursor-col-resize touch-none justify-center lg:flex"
            >
              <span className="sticky top-1/2 h-12 w-1 rounded-full bg-gray-300 group-hover:bg-blue-400" />
            </div>
            <div className="order-first min-w-0 lg:order-none">
              <ScanPanel
                itemId={itemId}
                cards={{ A: cardA, B: cardB }}
                tag={scan}
                onTagChange={onScanChange}
                onClose={closeScan}
                bottomInset={bottomInset}
                pointAt={pointAt}
              />
            </div>
          </div>
        ) : (
          <div onPointerDownCapture={noteSelectingSide} className={`mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 ${ONE_SIDE_SELECTION}`}>
            {panel('A', cardA)}
            {panel('B', cardB)}
          </div>
        )}

        {afterTexts}

        <div className="fixed inset-x-0 z-30 mx-auto max-w-2xl px-4" style={{ bottom: (bottomInset ?? 0) + 8 }}>
          <SelectionBar selection={selection} onAddNote={onAddNote} className="rounded-lg border border-gray-200 shadow-lg" />
        </div>

        {/* Collapsed by default: the scores anchor reviewers toward agreeing with the machine. */}
        <details className="mt-4 rounded-lg border border-gray-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm text-gray-600 hover:text-gray-900">
            {t('dedup.evidence.showDetails')}
          </summary>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-200 px-4 py-4 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-5">
            <Metric k={t('dedup.evidence.metric.sharedWording')} v={pct(m.jaccard)} note={t('dedup.evidence.metric.sharedWordingNote')} />
            <Metric k={t('dedup.evidence.metric.containment')} v={pct(m.containment)} note={t('dedup.evidence.metric.containmentNote')} />
            <Metric k={t('dedup.evidence.metric.openingSimilarity')} v={pct(m.head_sim)} />
            <Metric k={t('dedup.evidence.metric.endingSimilarity')} v={pct(m.tail_sim)} />
            <Metric k={t('dedup.evidence.metric.titleMatch')} v={pct(m.title_lev)} />
            <Metric
              k={t('dedup.evidence.metric.authorMatch')}
              v={pct(m.author_lev)}
              note={m.author_lev == null ? t('dedup.evidence.metric.noAuthorData') : undefined}
            />
            <Metric
              k={t('dedup.evidence.metric.lengthRatio')}
              v={m.len_ratio != null ? m.len_ratio.toFixed(2) : '—'}
              note={t('dedup.evidence.metric.lengthRatioNote')}
            />
            <Metric
              k={t('dedup.evidence.metric.sameScan')}
              v={m.same_rep == null ? '—' : t(m.same_rep ? 'dedup.common.yes' : 'dedup.common.no')}
              note={t('dedup.evidence.metric.sameScanNote')}
            />
            {/* BDRC ids, so a pair can be looked up in the source data. */}
            <div className="col-span-full grid grid-cols-1 gap-x-6 gap-y-2 border-t border-gray-100 pt-3 sm:grid-cols-2">
              {[
                [t('dedup.evidence.textAId'), cardA.mw_id],
                [t('dedup.evidence.textBId'), cardB.mw_id],
              ].map(([k, id]) => (
                <div key={k} className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
                  <div className="select-all break-all font-mono text-xs text-gray-700">{id || '—'}</div>
                </div>
              ))}
            </div>
            {ev.why && (
              <div className="col-span-full break-all border-t border-gray-100 pt-3 font-mono text-xs text-gray-400">
                {ev.why}
              </div>
            )}
          </div>
        </details>
    </>
  );
}

const SPLIT_KEY = 'dedup.scanSplit';
const SPLIT_DEFAULT = 42; // % of the width for the texts; pecha folios are wide
const SPLIT_MIN = 25;
const SPLIT_MAX = 70;

function readSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

/** Width of the texts column, as a % of the row; dragged from the divider, remembered per browser. */
function useSplit() {
  const ref = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(readSplit);

  const save = (v: number) => {
    try {
      localStorage.setItem(SPLIT_KEY, String(Math.round(v)));
    } catch {
      // Private window or blocked storage: the split just is not remembered.
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const row = ref.current;
    if (!row) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = row.getBoundingClientRect();
    let last = pct;
    const move = (ev: PointerEvent) => {
      last = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((ev.clientX - rect.left) / rect.width) * 100));
      setPct(last);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      save(last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const reset = () => {
    setPct(SPLIT_DEFAULT);
    save(SPLIT_DEFAULT);
  };

  return { ref, pct, onPointerDown, reset };
}

function Metric({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
      <div className={`text-sm tabular-nums ${v === '—' || v === 'not scored' ? 'text-gray-400' : 'text-gray-900'}`}>
        {v}
      </div>
      {note && <div className="text-[11px] text-gray-400">{note}</div>}
    </div>
  );
}
