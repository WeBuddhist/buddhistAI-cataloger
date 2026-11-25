import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { DialogTitle } from '@/components/ui/dialog';
import { useNames, usePersonImage, usePersonRecord, usePersonWorks } from '../hooks';
import { BO } from '../labels';
import type { BdrcPerson, BdrcWork, RecordRow, RecordValue } from '../types';
import { bdrcPage, boDigits, hasTibetan } from '../utils';

const LINK = 'text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline';
/** Longer lists start folded. */
const SHOWN = 6;

const fontOf = (text: string) => (hasTibetan(text) ? 'font-monlam' : '');

/** A person's BDRC record as a name card, like the box beside a Wikipedia article. */
export default function PersonInfobox({ person }: Readonly<{ person: BdrcPerson }>) {
  const record = usePersonRecord(person.id);
  const { life = [], relations = [], links = [] } = record.data ?? {};
  const ids = [...life, ...relations].flatMap((r) => r.values.flatMap((v) => ('id' in v.value ? [v.value.id] : [])));
  const { nameOf } = useNames([...new Set(ids)]);

  return (
    <article className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-gray-300 bg-white" lang="bo">
      {/* Known from the search, so there at once. */}
      <header className="border-b border-gray-200 bg-sky-50 px-4 py-3 text-center">
        <DialogTitle className="break-words font-monlam text-2xl font-normal leading-loose text-gray-900">{person.nameBo}</DialogTitle>
        {person.dates && <p className={`text-base leading-loose text-gray-700 ${fontOf(person.dates)}`}>{person.dates}</p>}
        <p className="font-mono text-xs text-gray-500">{person.id}</p>
      </header>
      {record.data && <Portrait key={record.data.wikidataId} wikidataId={record.data.wikidataId} name={person.nameBo} />}
      <dl className="divide-y divide-gray-100">
        {record.isLoading && <Loading />}
        {record.isError && (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" lang="en">
            Could not load the details from BDRC.{' '}
            <button type="button" className="cursor-pointer font-medium underline" onClick={() => record.refetch()}>
              Try again
            </button>
          </div>
        )}
        <ValueRows rows={life} nameOf={nameOf} />
        <WorksRow personId={person.id} />
        <ValueRows rows={relations} nameOf={nameOf} />
        {links.length > 0 && (
          <Row label={BO.otherSites}>
            <span className="flex flex-wrap gap-x-4 text-sm leading-9">
              {links.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {l.label}
                </a>
              ))}
            </span>
          </Row>
        )}
      </dl>
    </article>
  );
}

function Loading() {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading from BDRC">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <div key={n} className="h-5 animate-pulse rounded bg-gray-100" />
      ))}
    </div>
  );
}

function Portrait({ wikidataId, name }: Readonly<{ wikidataId: string | null; name: string }>) {
  const { data } = usePersonImage(wikidataId);
  const [broken, setBroken] = useState(false);
  if (!data || broken) return null;
  return (
    <figure className="border-b border-gray-100 px-4 py-4 text-center">
      <img
        src={data.src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="mx-auto max-h-64 max-w-full rounded"
      />
      <figcaption className="mt-1.5 text-xs">
        <a href={data.page} target="_blank" rel="noopener noreferrer" className={LINK}>
          Wikimedia Commons
        </a>
      </figcaption>
    </figure>
  );
}

function Row({ label, children }: Readonly<{ label: ReactNode; children: ReactNode }>) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 px-4 py-1.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="break-words font-monlam text-base leading-9 text-gray-600">{label}</dt>
      <dd className="min-w-0 break-words text-base leading-9 text-gray-900">{children}</dd>
    </div>
  );
}

function SeeMore({ onClick, disabled = false, children }: Readonly<{ onClick: () => void; disabled?: boolean; children?: ReactNode }>) {
  return (
    // In another font, size and color than the values it stands under.
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mb-1 mt-0.5 inline-flex cursor-pointer items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 font-sans text-xs leading-5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:cursor-default disabled:opacity-50"
    >
      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
      {BO.seeMore} {children}
    </button>
  );
}

type NameOf = (id: string) => string | undefined;

function ValueRows({ rows, nameOf }: Readonly<{ rows: RecordRow[]; nameOf: NameOf }>) {
  return rows.map((row, i) => <ValueRow key={`${row.label}-${i}`} row={row} nameOf={nameOf} />);
}

/** One value a line. */
function ValueRow({ row, nameOf }: Readonly<{ row: RecordRow; nameOf: NameOf }>) {
  const [open, setOpen] = useState(false);
  const { label, values } = row;
  // One more than fits is shown rather than folded.
  const folded = !open && values.length > SHOWN + 1;
  return (
    <Row label={label}>
      <ul>
        {(folded ? values.slice(0, SHOWN) : values).map((v, i) => (
          <li key={i} className={v.label ? 'flex gap-3' : ''}>
            {v.label && <span className="w-16 shrink-0 font-monlam text-sm leading-9 text-gray-500">{v.label}</span>}
            <Value value={v.value} nameOf={nameOf} />
          </li>
        ))}
      </ul>
      {folded && <SeeMore onClick={() => setOpen(true)}>({boDigits(values.length)})</SeeMore>}
    </Row>
  );
}

const NamePlaceholder = () => <span className="inline-block h-4 w-40 max-w-full animate-pulse rounded bg-gray-100 align-middle" />;

function Value({ value, nameOf }: Readonly<{ value: RecordValue; nameOf: NameOf }>) {
  if ('text' in value) return <span className={`min-w-0 ${fontOf(value.text)}`}>{value.text}</span>;
  const name = nameOf(value.id);
  if (name == null) return <NamePlaceholder />;
  // Persons and places have pages of their own; terms are only words.
  if (!/^[PG]\w*\d/.test(value.id)) return <span className={`min-w-0 ${fontOf(name)}`}>{name}</span>;
  return (
    <a href={bdrcPage(value.id)} target="_blank" rel="noopener noreferrer" title={value.id} className={`min-w-0 ${LINK} ${fontOf(name)}`}>
      {name}
    </a>
  );
}

/** What BDRC has by them. */
function WorksRow({ personId }: Readonly<{ personId: string }>) {
  const query = usePersonWorks(personId);
  const pages = query.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  const loaded = pages.reduce((n, p) => n + p.works.length, 0);
  // Their record goes on without it when they have none.
  if (query.isSuccess && total === 0) return null;

  return (
    <Row
      label={
        <>
          {BO.works} {total > 0 && <span className="whitespace-nowrap text-sm text-gray-500">({boDigits(total)})</span>}
        </>
      }
    >
      {query.isLoading && <NamePlaceholder />}
      {query.isError && loaded === 0 && (
        <span className="text-sm text-red-700" lang="en">
          Could not load these from BDRC.{' '}
          <button type="button" className="cursor-pointer font-medium underline" onClick={() => query.refetch()}>
            Try again
          </button>
        </span>
      )}
      <ul>
        {pages.map((page) => (
          <WorkItems key={page.works[0]?.id} works={page.works} />
        ))}
      </ul>
      {query.hasNextPage && (
        <SeeMore onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          ({boDigits(loaded)}/{boDigits(total)})
        </SeeMore>
      )}
      {query.isFetchNextPageError && (
        <span className="ml-2 text-xs text-red-700" lang="en">
          Could not load more. Try again.
        </span>
      )}
    </Row>
  );
}

/** A page of works; the names of the books they are in come a moment later. */
function WorkItems({ works }: Readonly<{ works: BdrcWork[] }>) {
  const { nameOf } = useNames([...new Set(works.flatMap((w) => w.collectionId ?? []))]);
  return works.map((work) => {
    const collection = work.collectionId && nameOf(work.collectionId);
    return (
      <li key={work.id} className="pb-1">
        <a href={bdrcPage(work.id)} target="_blank" rel="noopener noreferrer" title={work.id} className={`${LINK} ${fontOf(work.title)}`}>
          {work.title}
        </a>
        {collection && <span className={`block text-sm leading-7 text-gray-500 ${fontOf(collection)}`}>{collection}</span>}
      </li>
    );
  });
}
