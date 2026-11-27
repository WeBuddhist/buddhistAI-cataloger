import { Copy, X } from 'lucide-react';
import { BO } from '../labels';
import type { BdrcPerson, DuplicateReport } from '../types';
import { useT } from '../i18n';

export default function PersonCard({
  person,
  selected,
  onSelect,
  onView,
  onIntent,
  reports,
  onReport,
  onRemoveReport,
}: Readonly<{
  person: BdrcPerson;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  /** About to view: the pointer or focus is on the button. */
  onIntent: () => void;
  /** This person's duplicate reports, unless decided to be someone else. */
  reports: DuplicateReport[];
  onReport: () => void;
  /** Take back my report, while no admin has decided it. */
  onRemoveReport: (report: DuplicateReport) => void;
}>) {
  const t = useT();
  return (
    <li className={`rounded-lg border ${selected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
      <label className="flex cursor-pointer gap-3 px-3 pt-2.5">
        {/* A box: a text can have several persons; clicking again takes one back. */}
        <input type="checkbox" name="bdrc-person" checked={selected} onChange={onSelect} className="mt-2.5 h-4 w-4 shrink-0 accent-blue-600" />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-monlam text-base leading-loose text-gray-900">{person.nameBo}</span>
          {person.matchedName && (
            <span className="block break-words font-monlam text-sm leading-loose text-gray-600">
              {BO.otherName} {person.matchedName}
            </span>
          )}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2 pl-10 pr-2 text-xs text-gray-600">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">{person.id}</span>
        {person.dates && <span className="min-w-0 truncate font-monlam text-sm leading-loose text-gray-700">{person.dates}</span>}
        {/* Each report a badge; mine, while not decided, with a ✕ to take it back. */}
        {reports.map((report) => {
          const other = report.persons.find((p) => p.id !== person.id);
          if (!other) return null;
          return (
            <span
              key={report.id}
              title={report.decision ? t('person.sameAsTitle', { id: other.id }) : t('person.reportedTitle', { id: other.id })}
              className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2 font-medium ${report.mine && !report.decision ? 'pr-1' : 'pr-2'} ${
                report.decision ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-900'
              }`}
            >
              {report.decision ? t('person.sameAs', { id: other.id }) : t('person.reportedWith', { id: other.id })}
              {report.mine && !report.decision && (
                <button
                  type="button"
                  onClick={() => onRemoveReport(report)}
                  aria-label={t('person.removeReport')}
                  title={t('person.removeReport')}
                  className="cursor-pointer rounded-full p-0.5 text-amber-800 hover:bg-amber-200 hover:text-red-700"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-1 pb-1.5 pl-8 pr-2 pt-1 text-xs">
        <button
          type="button"
          onClick={onView}
          onPointerEnter={onIntent}
          onFocus={onIntent}
          aria-label={t('person.viewDetailsOf', { name: person.nameBo })}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-600 hover:bg-blue-100"
        >
          {t('person.viewDetails')}
        </button>
        <button
          type="button"
          onClick={onReport}
          aria-label={t('person.reportDuplicateOf', { name: person.nameBo, id: person.id })}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          <Copy className="h-3 w-3" aria-hidden /> {t('person.reportDuplicate')}
        </button>
      </div>
    </li>
  );
}
