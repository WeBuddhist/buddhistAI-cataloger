import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/useUser';
import { useDecideDuplicate, useDuplicates } from '../hooks';
import SampleNotice from '../sample/SampleNotice';
import type { BdrcPerson, DuplicateDecision, DuplicateReport } from '../types';
import { bdrcPage, dateOf, FIELD } from '../utils';

type Tab = 'open' | 'checked';

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'To check' },
  { key: 'checked', label: 'Checked' },
];

/** People reported to have two BDRC ids, to be checked one by one. Nothing here changes BDRC. */
export default function AdminDuplicates() {
  const duplicates = useDuplicates();
  const [tab, setTab] = useState<Tab>('open');
  const reports = duplicates.data ?? [];
  const lists: Record<Tab, DuplicateReport[]> = {
    open: reports.filter((r) => !r.decision),
    checked: reports.filter((r) => r.decision),
  };

  return (
    <div className="py-6">
      <p className="mb-4 text-sm text-gray-600">
        People reported to have two BDRC IDs. Check each case, then mark it here. Nothing changes in BDRC.
      </p>
      <SampleNotice kind="reports" canClear={reports.length > 1 || lists.checked.length > 0} />

      <div className="mb-3 inline-flex rounded-md bg-gray-100 p-1" role="tablist" aria-label="Duplicates">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {label} <span className="tabular-nums text-gray-500">{lists[key].length}</span>
          </button>
        ))}
      </div>

      {duplicates.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load the reports: {duplicates.error.message}
        </div>
      )}
      {duplicates.isLoading && <div className="h-40 animate-pulse rounded-lg bg-gray-100" />}
      {duplicates.isSuccess && lists[tab].length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500">
          {tab === 'open' ? 'No reports to check.' : 'No reports checked yet.'}
        </p>
      )}
      <ul className="space-y-4">
        {lists[tab].map((r) => (
          <Report key={r.id} report={r} />
        ))}
      </ul>
    </div>
  );
}

function Report({ report }: Readonly<{ report: DuplicateReport }>) {
  const { user } = useUser();
  const decide = useDecideDuplicate();
  const [note, setNote] = useState('');
  const { decision } = report;

  const save = async (kind: DuplicateDecision | null) => {
    const by = user?.name || user?.email || 'Unknown';
    try {
      await decide.mutateAsync({ id: report.id, decision: kind && { kind, note: note.trim(), by } });
    } catch {
      toast.error('Could not save. Try again.');
    }
  };

  return (
    <li className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="grid divide-y divide-gray-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {report.persons.map((p) => (
          <Person key={p.id} person={p} />
        ))}
      </div>
      <div className="border-t border-gray-200 px-5 py-3 text-sm">
        <p className="whitespace-pre-wrap break-words text-gray-900">{report.reason}</p>
        <p className="mt-1 text-xs text-gray-500">
          {report.reportedBy} · {dateOf(report.reportedAt)} · from{' '}
          <Link to={`/author-identification/${report.text.id}`} className="font-monlam text-sm text-blue-600 hover:underline">
            {report.text.title}
          </Link>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
        {decision ? (
          <>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                decision.kind === 'same' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {decision.kind === 'same' ? 'Same person' : 'Different people'}
            </span>
            <span className="min-w-0 flex-1 break-words text-sm text-gray-600">
              {decision.by} · {dateOf(decision.at)}
              {decision.note && ` · ${decision.note}`}
            </span>
            <Button variant="outline" size="sm" className="cursor-pointer bg-white" disabled={decide.isPending} onClick={() => save(null)}>
              Check again
            </Button>
          </>
        ) : (
          <>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Note"
              placeholder="Note (optional)"
              className={`h-9 min-w-48 flex-1 ${FIELD}`}
            />
            <Button variant="outline" className="cursor-pointer bg-white" disabled={decide.isPending} onClick={() => save('different')}>
              <X /> Different people
            </Button>
            <Button className="cursor-pointer bg-green-600 text-white hover:bg-green-700" disabled={decide.isPending} onClick={() => save('same')}>
              <Check /> Same person
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function Person({ person }: Readonly<{ person: BdrcPerson }>) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="break-words font-monlam text-lg leading-loose text-gray-900">{person.nameBo}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">{person.id}</span>
        {person.dates && <span className="font-monlam leading-loose">{person.dates}</span>}
        <a
          href={bdrcPage(person.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
        >
          Open on BDRC <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
