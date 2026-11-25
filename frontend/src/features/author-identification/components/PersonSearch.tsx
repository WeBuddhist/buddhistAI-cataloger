import { useState, type FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDuplicates, useNameSuggestions, usePersonSearch, usePrefetchPerson } from '../hooks';
import type { BdrcPerson } from '../types';
import { cleanName, FIELD, reportOf } from '../utils';
import DuplicateDialog from './DuplicateDialog';
import PersonCard from './PersonCard';
import PersonDialog from './PersonDialog';

const BOX = 'rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-600';

/** Search BDRC's persons by name and pick one. */
export default function PersonSearch({
  text,
  query,
  searched,
  onQueryChange,
  onSearch,
  onShowVersions,
  selected,
  onSelect,
}: Readonly<{
  /** The text the author is looked for. */
  text: { id: string; title: string };
  query: string;
  /** The name the results are for; empty before the first search. */
  searched: string;
  onQueryChange: (query: string) => void;
  onSearch: (name: string) => void;
  onShowVersions: () => void;
  selected: BdrcPerson | null;
  onSelect: (person: BdrcPerson) => void;
}>) {
  const search = usePersonSearch(searched);
  const persons = search.data?.pages.flatMap((p) => p.persons) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;
  const nobody = search.isSuccess && total === 0;
  const suggestions = useNameSuggestions(searched, nobody);
  const [viewing, setViewing] = useState<number | null>(null);
  const prefetch = usePrefetchPerson();
  const duplicates = useDuplicates();
  const [reporting, setReporting] = useState<BdrcPerson | null>(null);

  /** The results come a page at a time; past the last one, the next page is loaded first. */
  const view = async (index: number) => {
    if (index >= persons.length) {
      const { data } = await search.fetchNextPage();
      const loaded = data?.pages.reduce((n, p) => n + p.persons.length, 0) ?? 0;
      if (index >= loaded) return;
    }
    // Not when it was closed meanwhile.
    setViewing((current) => (current == null ? null : index));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (cleanName(query)) onSearch(query);
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Author name"
          placeholder="Tibetan, Wylie or English"
          className={`h-10 flex-1 font-monlam text-base md:text-base ${FIELD}`}
        />
        <Button type="submit" className="h-10 cursor-pointer bg-blue-600 text-white hover:bg-blue-700" disabled={!cleanName(query)}>
          <Search /> Find
        </Button>
      </form>

      {search.isLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching BDRC…
        </div>
      )}
      {search.isError && persons.length === 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
          Could not search BDRC.{' '}
          <button type="button" className="cursor-pointer font-medium underline" onClick={() => search.refetch()}>
            Try again
          </button>
        </div>
      )}

      {nobody && (
        <div className={`${BOX} space-y-2`}>
          <p>
            Nobody found for <span className="font-monlam text-gray-900">{searched}</span>.
          </p>
          {suggestions.isLoading && (
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Trying shorter forms of the name…
            </p>
          )}
          {suggestions.data && suggestions.data.length > 0 && (
            <>
              <p>These shorter names do find someone:</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.data.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => onSearch(s.name)}
                    className="cursor-pointer rounded-full border border-gray-300 bg-white px-3 py-0.5 text-gray-800 hover:border-blue-600 hover:text-blue-700"
                  >
                    <span className="font-monlam">{s.name}</span> <span className="text-xs text-gray-500">({s.total})</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <p>
            The name may be written differently, or given in another version.{' '}
            <button type="button" onClick={onShowVersions} className="cursor-pointer font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline">
              Check the versions
            </button>
          </p>
        </div>
      )}

      {persons.length > 0 && (
        <>
          <p className="text-sm text-gray-500">
            {total} {total === 1 ? 'person' : 'people'} for <span className="font-monlam text-sm text-gray-800">{searched}</span>
          </p>
          <ul className="space-y-2">
            {persons.map((p, i) => (
              <PersonCard
                key={p.id}
                person={p}
                selected={selected?.id === p.id}
                onSelect={() => onSelect(p)}
                onView={() => setViewing(i)}
                onIntent={() => prefetch(p.id)}
                report={reportOf(p.id, duplicates.data)}
                onReport={() => setReporting(p)}
              />
            ))}
          </ul>
          {search.isFetchNextPageError && <p className="text-xs text-red-700">Could not load more. Try again.</p>}
          {search.hasNextPage && (
            <Button
              variant="outline"
              className="w-full cursor-pointer"
              disabled={search.isFetchingNextPage}
              onClick={() => search.fetchNextPage()}
            >
              {search.isFetchingNextPage ? 'Loading…' : `Show more (${persons.length} of ${total})`}
            </Button>
          )}
        </>
      )}

      <PersonDialog
        persons={persons}
        index={viewing}
        total={total}
        selectedId={selected?.id ?? null}
        loadingMore={search.isFetchingNextPage}
        loadFailed={search.isFetchNextPageError}
        onIndexChange={(i) => void view(i)}
        onSelect={(p) => {
          onSelect(p);
          setViewing(null);
        }}
        onReport={(p) => {
          setViewing(null);
          setReporting(p);
        }}
        onClose={() => setViewing(null)}
      />
      {/* Keyed so each report starts empty. */}
      {reporting && (
        <DuplicateDialog key={reporting.id} person={reporting} searched={searched} text={text} onClose={() => setReporting(null)} />
      )}
    </div>
  );
}
