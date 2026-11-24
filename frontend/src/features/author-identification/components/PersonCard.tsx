import type { BdrcPerson } from '../types';

export default function PersonCard({
  person,
  selected,
  onSelect,
  onView,
}: Readonly<{ person: BdrcPerson; selected: boolean; onSelect: () => void; onView: () => void }>) {
  return (
    <li className={`rounded-lg border ${selected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
      <label className="flex cursor-pointer gap-3 px-3 pt-2.5">
        <input type="radio" name="bdrc-person" checked={selected} onChange={onSelect} className="mt-2.5 h-4 w-4 shrink-0 accent-blue-600" />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-monlam text-base leading-loose text-gray-900">{person.nameBo}</span>
          {person.nameWylie && <span className="block break-words text-xs text-gray-500">{person.nameWylie}</span>}
          {person.matchedName && (
            <span className="block text-xs text-gray-600">
              Matched on <span className="font-monlam text-sm">{person.matchedName}</span>
            </span>
          )}
        </span>
      </label>
      <div className="flex items-center gap-2 pb-2 pl-10 pr-2 text-xs text-gray-600">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">{person.id}</span>
        <span className="min-w-0 flex-1 truncate">{person.dates ?? 'No dates'}</span>
        <button
          type="button"
          onClick={onView}
          aria-label={`View details of ${person.nameBo}`}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-600 hover:bg-blue-100"
        >
          View details
        </button>
      </div>
    </li>
  );
}
