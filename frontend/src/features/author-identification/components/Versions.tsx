import { useState, type ReactNode } from 'react';
import { BookOpen, Calendar, ChevronLeft, ChevronRight, Hash, Landmark, Library, Type, User, type LucideIcon } from 'lucide-react';
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

const nameOf = (version: TextVersion) =>
  version.collection ? wylieToTibetan(version.collection.name) : (version.bdrcId ?? 'Not on BDRC');

/** What tells versions of the same name apart. */
const summaryOf = (details?: VersionDetails) =>
  [details?.printed, details?.date, details?.size].filter(Boolean).join(' · ');

/** The versions of a text: pick one, see what BDRC knows about it, and open its pages. */
export default function Versions({
  task,
  versionId,
  onVersionChange,
  onSearchName,
}: Readonly<{
  task: AuthorTask;
  /** Null for the first one on BDRC. */
  versionId: string | null;
  onVersionChange: (versionId: string) => void;
  onSearchName: (name: string) => void;
}>) {
  const { versions } = task;
  const details = useVersionDetails(task);
  const version = versions.find((v) => v.id === versionId && isOnBdrc(v)) ?? versions.find(isOnBdrc);
  // Kept from one version to the next, for comparing their collections.
  const [wanted, setPage] = useState<BdrcPage>('version');

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
      <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3">
        {/* One card, so the details read as those of the version named above them. */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xs">
          <div className="flex items-center gap-2 border-b border-gray-100 p-2">
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
          </div>
          <Details
            version={version}
            details={details.data?.[version.id]}
            loading={details.isLoading}
            failed={details.isError}
            onSearchName={onSearchName}
          />
        </div>
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
    <dl className="flex flex-wrap gap-x-8 gap-y-2.5 px-3.5 py-2.5">
      {/* Only its own record can say that there is no author; a collection's cannot. */}
      {details && version.bdrcId && (
        <Detail icon={User} label={BO.author}>
          {author ? (
            <span className="flex items-center gap-2">
              <span className="min-w-0 break-words font-monlam">{author}</span>
              <button
                type="button"
                onClick={() => onSearchName(author)}
                className="shrink-0 cursor-pointer rounded-full bg-blue-50 px-2.5 text-xs font-medium leading-5 text-blue-700 hover:bg-blue-100"
              >
                Search
              </button>
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
      {loading && <span className="self-center text-sm text-gray-500">Loading details…</span>}
      {failed && <span className="self-center text-sm text-gray-500">Could not load the other details.</span>}
    </dl>
  );
}

function Detail({ icon: Icon, label, children }: Readonly<{ icon: LucideIcon; label: string; children: ReactNode }>) {
  return (
    <div className="min-w-0">
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
