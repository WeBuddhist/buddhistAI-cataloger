import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { BookOpen, Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Hash, Images, Landmark, Library, Type, User, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useVersionDetails } from '../hooks';
import type { AuthorTask, TextVersion, VersionDetails } from '../types';
import { hasTibetan, isOnBdrc, wylieToTibetan } from '../utils';
import { BO } from '../labels';
import BdrcFrame from './BdrcFrame';

/** Which BDRC page of a version is shown: its own, or that of the collection it is in. */
type BdrcPage = 'version' | 'collection';

const firstPage = (version: TextVersion): BdrcPage => (version.bdrcId ? 'version' : 'collection');

// BDRC's editions API gives collection names in Tibetan already.
const tibetan = (name: string) => (hasTibetan(name) ? name : wylieToTibetan(name));

const nameOf = (version: TextVersion) =>
  version.collection ? tibetan(version.collection.name) : (version.bdrcId ?? 'Not on BDRC');

/** What tells versions of the same name apart. */
const summaryOf = (details?: VersionDetails) =>
  [details?.printed, details?.date, details?.size].filter(Boolean).join(' · ');

/** The versions of a text: pick one, see what BDRC knows about it, and open its pages. */
export default function Versions({
  task,
  versionId,
  onVersionChange,
  onSearchName,
  focus,
  onFocusChange,
}: Readonly<{
  task: AuthorTask;
  /** Null for the first one on BDRC. */
  versionId: string | null;
  onVersionChange: (versionId: string) => void;
  onSearchName: (name: string) => void;
  /** The BDRC page takes all the room: the text's header, the tabs and the details are hidden. */
  focus: boolean;
  onFocusChange: (focus: boolean) => void;
}>) {
  const { versions } = task;
  const details = useVersionDetails(task);
  const version = versions.find((v) => v.id === versionId && isOnBdrc(v)) ?? versions.find(isOnBdrc);
  // Kept from one version to the next, for comparing their collections.
  const [wanted, setPage] = useState<BdrcPage>('version');
  const [open, setOpen] = useDetailsOpen();

  if (!version) {
    return <p className="p-8 text-center text-sm text-gray-500">No version of this text is on BDRC.</p>;
  }

  const page = wanted === 'collection' && version.collection ? 'collection' : firstPage(version);
  const bdrcId = (page === 'collection' ? version.collection?.bdrcId : version.bdrcId) ?? '';
  const pick = (next: TextVersion) => onVersionChange(next.id);
  const number = (v: TextVersion) => versions.indexOf(v) + 1;
  const onBdrc = versions.filter(isOnBdrc);
  const previous = onBdrc[onBdrc.indexOf(version) - 1];
  const next = onBdrc[onBdrc.indexOf(version) + 1];

  const pageButton = (value: BdrcPage, label: string, available: boolean, why: string) => (
    <button
      type="button"
      aria-pressed={page === value}
      disabled={!available}
      title={available ? undefined : why}
      onClick={() => setPage(value)}
      className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        page === value ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Capped, so the BDRC page below always keeps most of the room. */}
      <div className={focus ? 'hidden' : 'max-h-[45%] shrink-0 overflow-y-auto bg-gray-50 px-4 py-3'}>
        {/* One card, so the details read as those of the version named above them. */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xs">
          <div className={`flex items-center gap-2 p-2 ${open ? 'border-b border-gray-100' : ''}`}>
            <Select value={version.id} onValueChange={(id) => pick(versions.find((v) => v.id === id) ?? version)}>
              <SelectTrigger
                aria-label="Choose a version"
                className="min-w-0 flex-1 cursor-pointer border-gray-300 bg-white px-2 py-1 text-left hover:border-blue-400 hover:bg-blue-50/50 data-[size=default]:h-auto"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="shrink-0 rounded-md bg-blue-50 px-2.5 py-1 text-sm font-semibold tabular-nums text-blue-700">
                    Version {number(version)} of {versions.length}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-monlam text-base leading-loose text-gray-900">{nameOf(version)}</span>
                  <span className="hidden shrink-0 font-medium text-blue-700 sm:inline">Change</span>
                </span>
              </SelectTrigger>
              <SelectContent align="start" className="w-(--radix-select-trigger-width) bg-white">
                {versions.map((v) => {
                  const chosen = v.id === version.id;
                  return (
                    <SelectItem
                      key={v.id}
                      value={v.id}
                      textValue={`${number(v)}`}
                      disabled={!isOnBdrc(v)}
                      className={`cursor-pointer py-2 focus:bg-blue-50 focus:text-gray-900 ${chosen ? 'bg-blue-50' : ''}`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums ${
                          chosen ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {number(v)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-base leading-loose ${isOnBdrc(v) ? 'font-monlam' : ''}`}>{nameOf(v)}</span>
                        <span className={`block text-gray-500 ${isOnBdrc(v) ? 'font-monlam text-sm' : 'text-xs'}`}>
                          {isOnBdrc(v) ? summaryOf(details.data?.[v.id]) : 'This copy has no BDRC page to open'}
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon-sm" aria-label="Previous version" title="Previous version" className="cursor-pointer bg-white" disabled={!previous} onClick={() => pick(previous)}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next version" title="Next version" className="cursor-pointer bg-white" disabled={!next} onClick={() => pick(next)}>
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={open}
              aria-controls="version-details"
              title={open ? 'Hide the details, for more room for the BDRC page' : 'Show the details of this version'}
              className="cursor-pointer bg-white text-gray-700"
              onClick={() => setOpen(!open)}
            >
              {open ? <ChevronUp /> : <ChevronDown />} <span className="hidden sm:inline">Details</span>
            </Button>
          </div>
          {open && (
            <div id="version-details">
              <Details
                version={version}
                details={details.data?.[version.id]}
                loading={details.isLoading}
                failed={details.isError}
                onSearchName={onSearchName}
              />
            </div>
          )}
        </div>
      </div>

      <PullBar focus={focus} onFocusChange={onFocusChange} />
      <div className="min-h-0 flex-1">
        <BdrcFrame bdrcId={bdrcId} title={`BDRC page ${bdrcId}`}>
          <div className="inline-flex gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
            {pageButton('version', 'This version', Boolean(version.bdrcId), 'This version has no BDRC page of its own')}
            {pageButton('collection', 'Its collection', Boolean(version.collection), 'This version is in no BDRC collection')}
          </div>
        </BdrcFrame>
      </div>
    </div>
  );
}

// Characters; past this a title would push the other details onto a second line anyway.
const LONG_TITLE = 40;

function Details({
  version,
  details,
  loading,
  failed,
  onSearchName,
}: Readonly<{
  version: TextVersion;
  details?: VersionDetails;
  loading: boolean;
  failed: boolean;
  onSearchName: (name: string) => void;
}>) {
  const author = details?.author;
  const found = version.nameInVersion;
  return (
    <dl className="flex flex-wrap items-start gap-x-6 gap-y-2 px-3 py-2">
      {version.title && (
        // A long title has a line of its own, in full; a short one sits in the row with the rest.
        <Detail icon={BookOpen} label="Title" wide={version.title.length > LONG_TITLE}>
          <span className="font-monlam text-base">{version.title}</span>
        </Detail>
      )}
      {found && (
        <Detail icon={User} label="Name in this version">
          <span className="flex items-center gap-2">
            <span className="min-w-0 break-words font-monlam text-base">{found}</span>
            <SearchButton onClick={() => onSearchName(found)} />
          </span>
        </Detail>
      )}
      {/* Only its own record can say that there is no author; a collection's cannot. */}
      {details && version.bdrcId && (
        <Detail icon={User} label={BO.author}>
          {author ? (
            <span className="flex items-center gap-2">
              <span className="min-w-0 break-words font-monlam">{author}</span>
              <SearchButton onClick={() => onSearchName(author)} />
            </span>
          ) : (
            <span className="font-normal text-gray-400">—</span>
          )}
        </Detail>
      )}
      {details?.printed && (
        <Detail icon={BookOpen} label={BO.printMethod}>
          {details.printed}
        </Detail>
      )}
      {details?.date && (
        <Detail icon={Calendar} label={BO.published}>
          {details.date}
        </Detail>
      )}
      {details?.publisher && (
        <Detail icon={Landmark} label={BO.publisher}>
          {/* Some are very long; the whole of it shows on hover. */}
          <span className={`block max-w-60 truncate ${hasTibetan(details.publisher) ? 'font-monlam' : 'capitalize'}`} title={details.publisher}>
            {details.publisher}
          </span>
        </Detail>
      )}
      {details?.size && (
        <Detail icon={Library} label={BO.extent}>
          {details.size}
        </Detail>
      )}
      {details?.script && (
        <Detail icon={Type} label={BO.script}>
          {details.script}
        </Detail>
      )}
      <Detail icon={Hash} label="BDRC ID">
        <span className="tabular-nums">{version.bdrcId ?? version.collection?.bdrcId}</span>
      </Detail>
      {version.scansUrl && (
        <Detail icon={Images} label="Scans">
          <a
            href={version.scansUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
          >
            Open scans <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </Detail>
      )}
      {loading && <span className="self-center text-sm text-gray-500">Loading details…</span>}
      {failed && <span className="self-center text-sm text-gray-500">Could not load the other details.</span>}
    </dl>
  );
}

function SearchButton({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 cursor-pointer rounded-full bg-blue-50 px-2.5 font-sans text-xs font-medium leading-5 text-blue-700 hover:bg-blue-100"
    >
      Search
    </button>
  );
}

function Detail({ icon: Icon, label, wide, children }: Readonly<{ icon: LucideIcon; label: string; wide?: boolean; children: ReactNode }>) {
  return (
    <div className={wide ? 'min-w-0 basis-full' : 'min-w-0'}>
      <dt className={`flex items-center gap-1.5 text-gray-500 ${hasTibetan(label) ? 'font-monlam text-sm' : 'text-xs'}`}>
        <Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden /> {label}
      </dt>
      <dd
        className={`mt-0.5 break-words font-medium leading-7 text-gray-900 ${
          typeof children === 'string' && hasTibetan(children) ? 'font-monlam text-base' : 'text-sm'
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

const DETAILS_KEY = 'author-identification:version-details-open';

/** Whether a version's details are shown, remembered from text to text. Shown at first. */
function useDetailsOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(DETAILS_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const change = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(DETAILS_KEY, next ? 'open' : 'closed');
    } catch {
      /* kept for this visit only */
    }
  };
  return [open, change];
}

// Pixels to drag before focus mode turns on or off; less is a click.
const PULL = 24;

/**
 * Between the details and the BDRC page: drag it up (or click it) for focus mode, where the
 * BDRC page takes all the room; drag it down (or click, or Esc) to bring everything back.
 * Our page cannot see scrolling inside BDRC's page, so this is done by hand.
 */
function PullBar({ focus, onFocusChange }: Readonly<{ focus: boolean; onFocusChange: (focus: boolean) => void }>) {
  const from = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    from.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (from.current != null) setPull(e.clientY - from.current);
  };
  const up = () => {
    if (from.current == null) return;
    from.current = null;
    setPull(0);
    if (pull < -PULL) onFocusChange(true);
    else if (pull > PULL) onFocusChange(false);
    else if (Math.abs(pull) < 5) onFocusChange(!focus);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowUp: true, ArrowDown: false, Enter: !focus, ' ': !focus }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onFocusChange(next);
  };
  // Says what letting go will do, while dragging.
  let hint = focus ? 'Drag down or press Esc to show the details again' : 'Drag up for more room';
  if (pull < -PULL && !focus) hint = 'Let go for focus mode';
  if (pull > PULL && focus) hint = 'Let go to show the details';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={focus}
      aria-label={focus ? 'Leave focus mode' : 'Focus mode: give the BDRC page all the room'}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      className={`group relative flex h-7 shrink-0 cursor-ns-resize touch-none select-none items-center justify-center gap-2 border-y border-gray-200 text-xs transition-colors ${
        from.current != null ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-700'
      }`}
    >
      {/* While dragging, the BDRC page must not take the pointer. */}
      {from.current != null && <div className="fixed inset-0 z-10 cursor-ns-resize" />}
      <span className="h-1 w-10 rounded-full bg-gray-300 group-hover:bg-blue-400" />
      <span>{hint}</span>
      {focus && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onFocusChange(false)}
          className="absolute right-3 cursor-pointer rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:border-blue-400 hover:text-blue-700"
        >
          Exit focus
        </button>
      )}
    </div>
  );
}
