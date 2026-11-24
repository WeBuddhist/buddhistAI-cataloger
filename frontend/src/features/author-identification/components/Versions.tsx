import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useVersionDetails } from '../hooks';
import type { AuthorTask, TextVersion, VersionDetails } from '../types';
import { hasTibetan, isOnBdrc, wylieToTibetan } from '../utils';
import BdrcFrame from './BdrcFrame';

/** Which BDRC page of a version is shown: its own, or that of the collection it is in. */
type BdrcPage = 'version' | 'collection';

const firstPage = (version: TextVersion): BdrcPage => (version.bdrcId ? 'version' : 'collection');

const nameOf = (version: TextVersion) =>
  version.collection ? wylieToTibetan(version.collection.name) : (version.bdrcId ?? 'Not on BDRC');

/** What tells versions of the same name apart. */
const summaryOf = (details?: VersionDetails) =>
  [details?.printed, details?.date, details?.size].filter(Boolean).join(' · ');

/** The versions of a text: pick one, see what BDRC knows about it, and open its pages. */
export default function Versions({ task, onSearchName }: Readonly<{ task: AuthorTask; onSearchName: (name: string) => void }>) {
  const { versions } = task;
  const details = useVersionDetails(task);
  const [version, setVersion] = useState(() => versions.find(isOnBdrc) ?? null);
  const [page, setPage] = useState<BdrcPage>(version ? firstPage(version) : 'version');
  const bdrcId = page === 'collection' ? version?.collection?.bdrcId : version?.bdrcId;

  if (!version || !bdrcId) {
    return <p className="p-8 text-center text-sm text-gray-500">No version of this text is on BDRC.</p>;
  }

  const pick = (next: TextVersion) => {
    setVersion(next);
    // Stay on collections while comparing them, when the next version has one.
    setPage(page === 'collection' && next.collection ? 'collection' : firstPage(next));
  };
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
      <div className="shrink-0 space-y-2.5 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-stretch gap-2">
          <Select value={version.id} onValueChange={(id) => pick(versions.find((v) => v.id === id) ?? version)}>
            <SelectTrigger
              aria-label="Choose a version"
              className="min-w-0 flex-1 cursor-pointer border-2 border-blue-600 bg-white py-1.5 text-left hover:bg-blue-50 data-[size=default]:h-auto"
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-sm font-semibold tabular-nums text-white">
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
                        chosen ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {number(v)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-base leading-loose ${isOnBdrc(v) ? 'font-monlam' : ''}`}>{nameOf(v)}</span>
                      <span className="block text-xs text-gray-500">
                        {isOnBdrc(v) ? summaryOf(details.data?.[v.id]) : 'This copy has no BDRC page to open'}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" aria-label="Previous version" title="Previous version" className="h-auto w-10 cursor-pointer bg-white" disabled={!previous} onClick={() => pick(previous)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next version" title="Next version" className="h-auto w-10 cursor-pointer bg-white" disabled={!next} onClick={() => pick(next)}>
            <ChevronRight />
          </Button>
        </div>
        <Details
          version={version}
          details={details.data?.[version.id]}
          loading={details.isLoading}
          failed={details.isError}
          onSearchName={onSearchName}
        />
      </div>

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
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {author && (
        <Detail label="Author on BDRC">
          <span className="font-monlam">{author}</span>{' '}
          <button
            type="button"
            onClick={() => onSearchName(author)}
            className="cursor-pointer font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
          >
            Search
          </button>
        </Detail>
      )}
      {details?.printed && <Detail label="Type">{details.printed}</Detail>}
      {details?.date && <Detail label="Published">{details.date}</Detail>}
      {details?.publisher && (
        <Detail label="Publisher">
          <span className={hasTibetan(details.publisher) ? 'font-monlam' : 'capitalize'}>{details.publisher}</span>
        </Detail>
      )}
      {details?.size && <Detail label="Collection size">{details.size}</Detail>}
      {details?.script && <Detail label="Script">{details.script}</Detail>}
      <Detail label="BDRC ID">{version.bdrcId ?? version.collection?.bdrcId}</Detail>
      {loading && <span className="text-gray-500">Loading details…</span>}
      {failed && <span className="text-gray-500">Could not load the other details.</span>}
    </dl>
  );
}

function Detail({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-gray-500">{label}:</dt>
      <dd className="min-w-0 break-words text-gray-900">{children}</dd>
    </div>
  );
}
