import { Copy } from 'lucide-react';
import { BO } from '../labels';
import type { BdrcPerson, DuplicateReport } from '../types';
import { useT } from '../i18n';

export default function PersonCard({
  person,
  selected,
  onSelect,
  onView,
  onIntent,
  report,
  onReport,
}: Readonly<{
  person: BdrcPerson;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  /** About to view: the pointer or focus is on the button. */
  onIntent: () => void;
  /** This person's duplicate report, unless it was decided they are someone else. */
  report: DuplicateReport | null;
  onReport: () => void;
}>) {
  const t = useT();
  const other = report?.persons.find((p) => p.id !== person.id);
  return (
    <li className={`rounded-lg border ${selected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
      <label className="flex cursor-pointer gap-3 px-3 pt-2.5">
        <input
          type="radio"
          name="bdrc-person"
          checked={selected}
          onChange={onSelect}
          // A chosen radio sends no change when clicked again: clicking it then takes it back.
          onClick={() => {
            if (selected) onSelect();
          }}
          className="mt-2.5 h-4 w-4 shrink-0 accent-blue-600"
        />
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
        {other && (
          <span
            title={report?.decision ? t('person.sameAsTitle', { id: other.id }) : t('person.reportedTitle', { id: other.id })}
            className={`rounded-full px-2 py-0.5 font-medium ${report?.decision ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-900'}`}
          >
            {report?.decision ? t('person.sameAs', { id: other.id }) : t('person.reportedWith', { id: other.id })}
          </span>
        )}
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
