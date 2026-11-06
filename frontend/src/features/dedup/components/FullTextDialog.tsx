import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsUpDown, Columns2, Rows2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import i18n from '@/i18n/config';
import type { DiffGranularity, WitnessCard } from '../api/review';
import { volumeOfText, volumesInOrder } from '../api/volumes';
import { buildDiffRows, dtypeOf, foldRows, typeCode, withoutNewlines, type DiffRow, type Piece } from '../diffRows';
import { useFullText, useTextDiff } from '../hooks/useReview';
import {
  ONE_SIDE_SELECTION,
  noteSelectingSide,
  selectionIn,
  useCrossSelection,
  useScrollToMark,
  type Marks,
  type Picked,
  type Tag,
} from '../hooks/useCrossSelection';
import { useVolume, useVolumeList } from '../hooks/useVolumes';
import type { NewNote } from '../notes';
import type { TextRange } from '../textMatch';
import { rangeInVolume } from '../textPlace';
import { displayText, formatNumber } from '../utils';
import { SourceBadge, WitnessMeta } from './SourceBadge';
import { IconButton, MarkedText, SelectionBar } from './TextSelection';

// Opens over the review page so Esc returns the reviewer to where they were. Full-text
// columns scroll independently: the copies rarely line up position for position.

export type FullTextView = 'side' | 'diff' | 'volume';

type Props = {
  a: WitnessCard;
  b: WitnessCard;
  view: FullTextView;
  onViewChange: (v: FullTextView) => void;
  onClose: () => void;
  /** Lets a selected passage get a note. Left out where notes cannot be written. */
  onAddNote?: (note: NewNote) => void;
};

export default function FullTextDialog({ a, b, view, onViewChange, onClose, onAddNote }: Readonly<Props>) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture phase, so the review shortcuts underneath do not also fire.
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex bg-gray-900/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={t('dedup.fullText.dialogLabel')}>
      <div className="flex min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl sm:rounded-xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="inline-flex rounded-md bg-gray-100 p-1" role="tablist">
            {(
              [
                ['side', t('dedup.evidence.fullTextsShort')],
                ['diff', t('dedup.evidence.differencesShort')],
                ['volume', t('dedup.volume.tab')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => onViewChange(key)}
                className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
                  view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === 'side' && (
            <span className="hidden text-xs text-gray-500 sm:inline">{t('dedup.fullText.scrollHint')}</span>
          )}
          <Button variant="outline" size="sm" className="ml-auto cursor-pointer" onClick={onClose}>
            <X className="h-4 w-4" /> {t('dedup.common.close')} <kbd className="ml-1 hidden rounded border px-1 font-mono text-[10px] opacity-60 sm:inline">Esc</kbd>
          </Button>
        </div>

        {view === 'side' && <SideBySide a={a} b={b} onAddNote={onAddNote} />}
        {view === 'diff' && <DiffView a={a} b={b} onAddNote={onAddNote} />}
        {view === 'volume' && <VolumeView a={a} b={b} onAddNote={onAddNote} />}
      </div>
    </div>
  );
}

// Below lg each text would only get half the sheet, so one is shown at a time.
function PaneTabs({ pane, onPane }: Readonly<{ pane: Tag; onPane: (tag: Tag) => void }>) {
  const { t } = useTranslation();
  return (
    <div className="flex border-b border-gray-200 lg:hidden" role="tablist">
      {(['A', 'B'] as const).map((tag) => (
        <button
          key={tag}
          role="tab"
          aria-selected={pane === tag}
          onClick={() => onPane(tag)}
          className={`flex-1 cursor-pointer py-2 text-sm font-medium ${
            pane === tag ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500'
          }`}
        >
          {t('dedup.fullText.textTab', { tag })}
        </button>
      ))}
    </div>
  );
}

function SideBySide({ a, b, onAddNote }: Readonly<{ a: WitnessCard; b: WitnessCard; onAddNote?: (note: NewNote) => void }>) {
  const [pane, setPane] = useState<Tag>('A');
  const textA = useFullText(a.mw_id);
  const textB = useFullText(b.mw_id);
  const shownA = useMemo(() => displayText(textA.data?.text_bo ?? ''), [textA.data]);
  const shownB = useMemo(() => displayText(textB.data?.text_bo ?? ''), [textB.data]);
  const selection = useCrossSelection({ A: shownA, B: shownB });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneTabs pane={pane} onPane={setPane} />
      <div
        onPointerDownCapture={noteSelectingSide}
        className={`grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-gray-200 ${ONE_SIDE_SELECTION}`}
      >
        <TextPane tag="A" card={a} query={textA} shown={shownA} marks={selection.marksFor('A')} onSelect={selection.select} className={pane === 'A' ? 'flex' : 'hidden lg:flex'} />
        <TextPane tag="B" card={b} query={textB} shown={shownB} marks={selection.marksFor('B')} onSelect={selection.select} className={pane === 'B' ? 'flex' : 'hidden lg:flex'} />
      </div>
      <SelectionBar selection={selection} onAddNote={onAddNote} className="border-t border-gray-200" />
    </div>
  );
}

function TextPane({
  tag,
  card,
  query,
  shown,
  marks,
  onSelect,
  className = 'flex',
}: Readonly<{
  tag: Tag;
  card: WitnessCard;
  query: { isLoading: boolean; error: Error | null; data?: unknown };
  shown: string;
  marks: Marks;
  onSelect: (side: Tag, picked: Picked | null) => void;
  className?: string;
}>) {
  const { t } = useTranslation();
  const scrollRef = useScrollToMark(marks.ranges[marks.active]?.start, marks.follow);
  return (
    <section data-side={tag} className={`${className} min-h-0 flex-col`}>
      <PaneHeader tag={tag} card={card} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {query.isLoading && <div className="py-12 text-center text-sm text-gray-500">{t('dedup.witness.loadingFullText')}</div>}
        {query.error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>{t('dedup.witness.fullTextUnavailable')}</strong> {query.error.message}
          </div>
        )}
        {query.data != null && (
          <div
            onPointerUp={(e) => onSelect(tag, selectionIn(e.currentTarget))}
            className="whitespace-pre-wrap break-words font-monlam text-lg leading-loose text-gray-900 sm:text-xl"
          >
            <MarkedText text={shown} marks={marks} />
          </div>
        )}
      </div>
    </section>
  );
}

// Whole volumes, for context around each text. Each side moves through its own work.
function VolumeView({ a, b, onAddNote }: Readonly<{ a: WitnessCard; b: WitnessCard; onAddNote?: (note: NewNote) => void }>) {
  const [pane, setPane] = useState<Tag>('A');
  const [shown, setShown] = useState<Record<Tag, string>>({ A: '', B: '' });
  const onShown = useCallback((tag: Tag, text: string) => setShown((s) => ({ ...s, [tag]: text })), []);
  const selection = useCrossSelection(shown);
  // A place in a volume means nothing on a note about the pair's texts, so only the words go.
  const addNote = onAddNote && ((note: NewNote) => onAddNote({ ...note, range: undefined }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneTabs pane={pane} onPane={setPane} />
      <div
        onPointerDownCapture={noteSelectingSide}
        className={`grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-gray-200 ${ONE_SIDE_SELECTION}`}
      >
        <VolumePane tag="A" card={a} marks={selection.marksFor('A')} onSelect={selection.select} onShown={onShown} className={pane === 'A' ? 'flex' : 'hidden lg:flex'} />
        <VolumePane tag="B" card={b} marks={selection.marksFor('B')} onSelect={selection.select} onShown={onShown} className={pane === 'B' ? 'flex' : 'hidden lg:flex'} />
      </div>
      <SelectionBar selection={selection} onAddNote={addNote} className="border-t border-gray-200" />
    </div>
  );
}

function VolumePane({
  tag,
  card,
  marks,
  onSelect,
  onShown,
  className,
}: Readonly<{
  tag: Tag;
  card: WitnessCard;
  marks: Marks;
  onSelect: (side: Tag, picked: Picked | null) => void;
  onShown: (tag: Tag, text: string) => void;
  className: string;
}>) {
  const { t } = useTranslation();
  const list = useVolumeList(card.rep_id);
  const volumes = useMemo(() => volumesInOrder(list.data ?? [], card), [list.data, card]);
  const home = useMemo(() => volumeOfText(volumes, card), [volumes, card]);
  const [chosen, setChosen] = useState<string | null>(null);
  const index = Math.max(0, volumes.findIndex((v) => v.vol_id === (chosen ?? home?.vol_id)));
  const volume = volumes[index];
  const text = useVolume(volume?.id);
  const fullText = useFullText(card.mw_id).data?.text_bo;
  const shown = useMemo(() => displayText(text.data?.text ?? ''), [text.data]);
  const isHome = volume != null && volume.vol_id === home?.vol_id;
  const place = useMemo(() => (isHome && shown && fullText ? rangeInVolume(shown, fullText) : null), [isHome, shown, fullText]);
  const selecting = marks.ranges.length > 0;
  const scrollRef = useScrollToMark(selecting ? marks.ranges[marks.active]?.start : place?.start, selecting ? marks.follow : true);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [volume?.id, scrollRef]);
  useEffect(() => {
    onShown(tag, shown);
  }, [tag, shown, onShown]);
  const unavailable = !list.isLoading && (list.error != null || volumes.length === 0);
  const otherVersion = volume != null && card.etext_source != null && volume.etext_source !== card.etext_source;

  return (
    <section data-side={tag} className={`${className} min-h-0 flex-col`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/60 px-4 py-2.5 sm:px-5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-200 text-sm font-semibold text-gray-700">{tag}</span>
        {volume && (
          <>
            <IconButton label={t('dedup.volume.previous')} onClick={() => setChosen(volumes[Math.max(0, index - 1)].vol_id)}>
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <select
              value={volume.vol_id}
              onChange={(e) => setChosen(e.target.value)}
              aria-label={t('dedup.volume.choose')}
              className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
            >
              {volumes.map((v) => (
                <option key={v.vol_id} value={v.vol_id}>
                  {t('dedup.volume.number', { n: formatNumber(v.volume_number) })}
                  {v.vol_id === home?.vol_id ? ` · ${t('dedup.volume.thisText')}` : ''}
                </option>
              ))}
            </select>
            <IconButton label={t('dedup.volume.next')} onClick={() => setChosen(volumes[Math.min(volumes.length - 1, index + 1)].vol_id)}>
              <ChevronRight className="h-4 w-4" />
            </IconButton>
            <SourceBadge source={volume.etext_source} />
          </>
        )}
      </header>
      {otherVersion && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 sm:px-5">{t('dedup.volume.otherVersion')}</div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {(list.isLoading || text.isLoading) && <div className="py-12 text-center text-sm text-gray-500">{t('dedup.volume.loading')}</div>}
        {unavailable && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('dedup.volume.unavailable')}</div>}
        {text.error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>{t('dedup.volume.failed')}</strong> {text.error.message}
          </div>
        )}
        {text.data != null && (
          <div
            onPointerUp={(e) => onSelect(tag, selectionIn(e.currentTarget))}
            className="whitespace-pre-wrap break-words font-monlam text-lg leading-loose text-gray-900 sm:text-xl"
          >
            <MarkedText text={shown} marks={selecting ? marks : { ranges: place ? [place] : [], active: 0 }} soft={!selecting} />
          </div>
        )}
      </div>
    </section>
  );
}

function PaneHeader({ tag, card }: Readonly<{ tag: 'A' | 'B'; card: WitnessCard }>) {
  const { t } = useTranslation();
  return (
    <header className="border-b border-gray-200 bg-gray-50/60 px-4 py-3 sm:px-5">
      <div className="flex items-start gap-2.5">
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-200 text-sm font-semibold text-gray-700">
          {tag}
        </span>
        <div className="min-w-0">
          <div className="break-words font-monlam text-lg leading-relaxed text-gray-900 sm:text-xl">
            {card.title_bo || <span className="font-sans text-sm italic text-gray-400">{t('dedup.witness.noTitle')}</span>}
          </div>
          {card.author_name_bo && <div className="font-monlam text-base text-gray-700">{card.author_name_bo}</div>}
        </div>
      </div>
      <div className="mt-2">
        <WitnessMeta card={card} />
      </div>
    </header>
  );
}


type DiffLayout = 'split' | 'unified';

const GRANULARITIES: DiffGranularity[] = ['syllable', 'char', 'line'];

/** A side's text as the rows show it, and where each row starts in it. */
function sideOfRows(rows: DiffRow[], side: 'a' | 'b') {
  const starts: number[] = [];
  let text = '';
  for (const row of rows) {
    starts.push(text.length);
    text += row[side].map((p) => p.text).join('');
  }
  return { text, starts };
}

function DiffView({ a, b, onAddNote }: Readonly<{ a: WitnessCard; b: WitnessCard; onAddNote?: (note: NewNote) => void }>) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<DiffGranularity>('syllable');
  // Two columns are too narrow on a phone.
  const [layout, setLayout] = useState<DiffLayout>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'unified' : 'split',
  );
  const diff = useTextDiff(a.mw_id, b.mw_id, granularity);
  // Line breaks are page layout, not text: dropped except in the line-by-line view.
  const chunks = useMemo(() => {
    const raw = diff.data?.diff ?? [];
    return diff.data?.granularity === 'line' ? raw : withoutNewlines(raw);
  }, [diff.data]);
  // BDRC marks differences that are only punctuation or spaces (tsheg, shad, …):
  // shown as plain text unless asked for, so the real differences stand out.
  const [showPunctuation, setShowPunctuation] = useState(false);
  const punctuation = typeCode(diff.data?.types, 'punctuation');
  const quiet = showPunctuation ? undefined : punctuation;
  const rows = useMemo(() => buildDiffRows(chunks, quiet), [chunks, quiet]);
  const blocks = useMemo(() => foldRows(rows), [rows]);
  // Each side numbered on its own: a row only one copy has gets no number on the other.
  const nums = useMemo(() => numberRows(rows), [rows]);
  const sideA = useMemo(() => sideOfRows(rows, 'a'), [rows]);
  const sideB = useMemo(() => sideOfRows(rows, 'b'), [rows]);
  const selection = useCrossSelection({ A: sideA.text, B: sideB.text });
  // Rows are not re-cut around a match: the row holding it is what gets highlighted.
  const matchSide = selection.selected?.side === 'A' ? 'B' : 'A';
  const matchMarks = selection.marksFor(matchSide);
  const match = selection.selected ? matchMarks.ranges[matchMarks.active] : undefined;
  const activeRow = match ? (matchSide === 'A' ? sideA : sideB).starts.filter((s) => s <= match.start).length - 1 : -1;
  const rowsRef = useScrollToMark(activeRow);
  const marksA = selection.marksFor('A');
  const marksB = selection.marksFor('B');
  const hitsOf = (index: number, row: DiffRow): RowHits => ({
    a: hitsInRow(marksA, sideA.starts[index], sideA.starts[index] + piecesLength(row.a)),
    b: hitsInRow(marksB, sideB.starts[index], sideB.starts[index] + piecesLength(row.b)),
  });
  const pickRows = () => {
    const picked = window.getSelection();
    const text = picked?.toString() ?? '';
    const range = picked?.rangeCount ? picked.getRangeAt(0) : null;
    const node = range?.startContainer;
    const element = node instanceof Element ? node : node?.parentElement;
    const rowText = element?.closest<HTMLElement>('[data-row-text]');
    const side = rowText?.closest<HTMLElement>('[data-side]')?.dataset.side as Tag | undefined;
    if (!range || !rowText || !side || !text.trim()) {
      selection.select('A', null);
      return;
    }
    const before = document.createRange();
    before.selectNodeContents(rowText);
    before.setEnd(range.startContainer, range.startOffset);
    const { starts } = side === 'A' ? sideA : sideB;
    const start = starts[Number(rowText.dataset.rowText)] + before.toString().length;
    // Rows are separate blocks, so the browser puts a line break between them in the text.
    selection.select(side, { text, range: { start, end: start + text.replace(/\n/g, '').length } });
  };
  // A place in these rows means nothing on a note about the pair's texts, so only the words go.
  const addNote = onAddNote && ((note: NewNote) => onAddNote({ ...note, range: undefined }));
  const punctuationCount = useMemo(
    () => (punctuation === undefined ? 0 : chunks.filter((c) => dtypeOf(c) === punctuation).length),
    [chunks, punctuation],
  );
  const changes = useMemo(
    () => chunks.filter((c) => c[0] !== 0 && (quiet === undefined || dtypeOf(c) !== quiet)).length,
    [chunks, quiet],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-gray-50/60 px-3 py-2.5 text-sm sm:px-4">
        <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5" role="radiogroup" aria-label={t('dedup.diff.layout')}>
          {(
            [
              ['split', t('dedup.diff.split'), Columns2],
              ['unified', t('dedup.diff.unified'), Rows2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="radio"
              aria-checked={layout === key}
              onClick={() => setLayout(key)}
              title={t(key === 'split' ? 'dedup.diff.splitTitle' : 'dedup.diff.unifiedTitle')}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                layout === key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {diff.data && (
          <span className="text-gray-600">
            <strong className="tabular-nums text-gray-900">
              {t('dedup.diff.percentSame', { pct: formatNumber(Math.round(diff.data.ratio * 100)) })}
            </strong>{' '}
            · {t('dedup.diff.changes', { count: changes, n: formatNumber(changes) })}
          </span>
        )}
        {punctuationCount > 0 && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-gray-600">
            <input
              type="checkbox"
              className="cursor-pointer"
              checked={showPunctuation}
              onChange={(e) => setShowPunctuation(e.target.checked)}
            />
            {t('dedup.diff.showPunctuation')}
          </label>
        )}
        <label className="ml-auto inline-flex items-center gap-2 text-gray-600">
          {t('dedup.diff.compareBy')}
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as DiffGranularity)}
            className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            {GRANULARITIES.map((value) => (
              <option key={value} value={value}>
                {t(`dedup.diff.granularity.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {layout === 'split' && (
        <div className="grid grid-cols-2 border-b border-gray-200 text-sm">
          <ColumnHead tag="A" card={a} tone="red" />
          <ColumnHead tag="B" card={b} tone="green" className="border-l border-gray-200" />
        </div>
      )}
      {layout === 'unified' && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-gray-200 px-4 py-2 text-sm">
          <ColumnHead tag="A" card={a} tone="red" bare />
          <ColumnHead tag="B" card={b} tone="green" bare />
        </div>
      )}

      <div
        ref={rowsRef}
        onPointerDownCapture={noteSelectingSide}
        onPointerUp={pickRows}
        className={`min-h-0 flex-1 overflow-auto ${ONE_SIDE_SELECTION}`}
      >
        {diff.isLoading && <div className="py-12 text-center text-sm text-gray-500">{t('dedup.diff.comparing')}</div>}
        {diff.error && (
          <div className="m-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>{t('dedup.diff.failed')}</strong> {diff.error.message}
          </div>
        )}
        {diff.data &&
          blocks.map((block) =>
            block.kind === 'fold' ? (
              <Fold key={`f${block.start}`} rows={block.rows} start={block.start} nums={nums} layout={layout} activeRow={activeRow} hitsOf={hitsOf} />
            ) : (
              block.rows.map((row, k) => (
                <Row key={block.start + k} row={row} index={block.start + k} num={nums[block.start + k]} layout={layout} active={block.start + k === activeRow} hits={hitsOf(block.start + k, row)} />
              ))
            ),
          )}
      </div>
      <SelectionBar selection={selection} onAddNote={addNote} className="border-t border-gray-200" />
    </div>
  );
}

const TONE = {
  red: 'bg-red-100 text-red-800',
  green: 'bg-green-100 text-green-800',
};

function ColumnHead({
  tag,
  card,
  tone,
  className = '',
  bare = false,
}: Readonly<{ tag: string; card: WitnessCard; tone: keyof typeof TONE; className?: string; bare?: boolean }>) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${bare ? '' : 'px-3 py-2 sm:px-4'} ${className}`}>
      <span className={`rounded px-1.5 font-semibold ${TONE[tone]}`}>{tag}</span>
      <span className="truncate font-monlam text-base text-gray-800">{card.title_bo}</span>
      <SourceBadge source={card.etext_source} />
    </div>
  );
}

const TEXT = 'whitespace-pre-wrap break-words font-monlam text-base leading-loose sm:text-lg';
const LINE_NO = 'w-8 shrink-0 select-none px-1 pt-1.5 text-right font-sans text-xs tabular-nums text-gray-400 sm:w-12 sm:px-2';

type RowHit = TextRange & { active: boolean };
type RowHits = { a: RowHit[]; b: RowHit[] };

const piecesLength = (pieces: Piece[]) => pieces.reduce((sum, p) => sum + p.text.length, 0);

/** The marks falling inside a row, as places in that row's own text. */
function hitsInRow(marks: Marks, from: number, to: number): RowHit[] {
  return marks.ranges.flatMap((r, i) =>
    r.start < to && r.end > from
      ? [{ start: Math.max(r.start, from) - from, end: Math.min(r.end, to) - from, active: i === marks.active }]
      : [],
  );
}

/** `text`, which starts at `at` in its row, with the marks that fall inside it. */
function withHits(text: string, at: number, hits: RowHit[]) {
  const parts: React.ReactNode[] = [];
  let done = 0;
  for (const hit of hits) {
    const start = Math.max(hit.start - at, done);
    const end = Math.min(hit.end - at, text.length);
    if (end <= start) continue;
    parts.push(text.slice(done, start));
    parts.push(
      <mark key={start} className={`rounded-sm ${hit.active ? 'bg-amber-300' : 'bg-amber-100'}`}>
        {text.slice(start, end)}
      </mark>,
    );
    done = end;
  }
  parts.push(text.slice(done));
  return parts;
}

function Pieces({ pieces, tone, hits = [] }: Readonly<{ pieces: Piece[]; tone: 'red' | 'green'; hits?: RowHit[] }>) {
  const mark = tone === 'red' ? 'rounded-sm bg-red-200/80 text-red-950' : 'rounded-sm bg-green-200/80 text-green-950';
  let at = 0;
  return (
    <>
      {pieces.map((p, i) => {
        const shown = withHits(p.text, at, hits);
        at += p.text.length;
        return p.changed ? (
          <span key={i} className={mark}>{shown}</span>
        ) : (
          <span key={i}>{shown}</span>
        );
      })}
    </>
  );
}

type RowNum = { a: number | null; b: number | null };

function numberRows(rows: DiffRow[]): RowNum[] {
  let a = 0;
  let b = 0;
  return rows.map((r) => ({ a: r.a.length ? ++a : null, b: r.b.length ? ++b : null }));
}


function Side({ pieces, n, index, hits, tone, changed, copy, className = '' }: Readonly<{
  pieces: Piece[];
  index: number;
  hits: RowHit[];
  n: number | null;
  tone: 'red' | 'green';
  changed: boolean;
  copy: 'A' | 'B';
  className?: string;
}>) {
  const tint = tone === 'red' ? 'bg-red-50' : 'bg-green-50';
  if (n == null) return <div className={`bg-gray-50 ${className}`} aria-label={i18n.t('dedup.diff.notIn', { copy })} />;
  return (
    <div data-side={copy} className={`flex min-w-0 ${changed ? tint : ''} ${className}`}>
      <span className={LINE_NO}>{n}</span>
      <div data-row-text={index} className={`min-w-0 flex-1 py-1 pr-2 sm:pr-4 ${TEXT} text-gray-900`}>
        <Pieces pieces={pieces} tone={tone} hits={hits} />
      </div>
    </div>
  );
}

type RowProps = { row: DiffRow; index: number; num: RowNum; layout: DiffLayout; hits: RowHits };

function Row({ active = false, ...row }: Readonly<RowProps & { active?: boolean }>) {
  return active ? (
    <div data-active-row>
      <RowBody {...row} />
    </div>
  ) : (
    <RowBody {...row} />
  );
}

function RowBody({ row, index, num, layout, hits }: Readonly<RowProps>) {
  if (layout === 'split') {
    return (
      <div className="grid grid-cols-2 border-b border-gray-100">
        <Side pieces={row.a} index={index} hits={hits.a} n={num.a} tone="red" changed={row.changed} copy="A" />
        <Side pieces={row.b} index={index} hits={hits.b} n={num.b} tone="green" changed={row.changed} copy="B" className="border-l border-gray-200" />
      </div>
    );
  }
  // Unified: an unchanged row once; a changed row as A's version, then B's.
  if (!row.changed) {
    return (
      <div data-side="A" className="flex border-b border-gray-100">
        <span className={LINE_NO}>{num.a}</span>
        <span className="w-6 shrink-0" />
        <div data-row-text={index} className={`min-w-0 flex-1 py-1 pr-2 sm:pr-4 ${TEXT} text-gray-900`}>
          {/* One line for both copies here, so it shows the marks of either. */}
          <Pieces pieces={row.a} tone="red" hits={[...hits.a, ...hits.b].sort((x, y) => x.start - y.start)} />
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-gray-100">
      {num.a != null && (
        <div data-side="A" className="flex bg-red-50">
          <span className={LINE_NO}>{num.a}</span>
          <span className="w-6 shrink-0 pt-1.5 text-center font-sans text-xs font-semibold text-red-700">A</span>
          <div data-row-text={index} className={`min-w-0 flex-1 py-1 pr-2 sm:pr-4 ${TEXT} text-gray-900`}>
            <Pieces pieces={row.a} tone="red" hits={hits.a} />
          </div>
        </div>
      )}
      {num.b != null && (
        <div data-side="B" className="flex bg-green-50">
          <span className={LINE_NO}>{num.b}</span>
          <span className="w-6 shrink-0 pt-1.5 text-center font-sans text-xs font-semibold text-green-700">B</span>
          <div data-row-text={index} className={`min-w-0 flex-1 py-1 pr-2 sm:pr-4 ${TEXT} text-gray-900`}>
            <Pieces pieces={row.b} tone="green" hits={hits.b} />
          </div>
        </div>
      )}
    </div>
  );
}

function Fold({
  rows,
  start,
  nums,
  layout,
  activeRow,
  hitsOf,
}: Readonly<{
  rows: DiffRow[];
  start: number;
  nums: RowNum[];
  layout: DiffLayout;
  activeRow: number;
  hitsOf: (index: number, row: DiffRow) => RowHits;
}>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const holdsMatch = activeRow >= start && activeRow < start + rows.length;
  if (open || holdsMatch) {
    return (
      <>
        {rows.map((row, k) => (
          <Row key={start + k} row={row} index={start + k} num={nums[start + k]} layout={layout} active={start + k === activeRow} hits={hitsOf(start + k, row)} />
        ))}
      </>
    );
  }
  return (
    <button
      onClick={() => setOpen(true)}
      className="flex w-full cursor-pointer items-center justify-center gap-2 border-b border-gray-200 bg-gray-50 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
    >
      <ChevronsUpDown className="h-3.5 w-3.5" />
      {t('dedup.diff.unchangedLines', { count: rows.length, n: formatNumber(rows.length) })} · {t('dedup.diff.show')}
    </button>
  );
}
