import { useState, type ReactNode } from 'react';
import type { AuthorTask } from '../types';
import { isOnBdrc } from '../utils';
import Versions from './Versions';

export type SourceTab = 'text' | 'versions';

const TAB = '-mb-px cursor-pointer border-b-2 px-4 py-2.5 text-sm font-medium transition-colors';

/** Where the author is looked for: the text, or its versions on BDRC. */
export default function SourceViewer({
  tab,
  onTabChange,
  task,
  onSearchName,
  children,
}: Readonly<{
  tab: SourceTab;
  onTabChange: (tab: SourceTab) => void;
  task: AuthorTask;
  onSearchName: (name: string) => void;
  /** The text. */
  children: ReactNode;
}>) {
  // BDRC is loaded the first time it is asked for, then kept, so going to the text and
  // back does not load the page again or lose the place in it.
  const [opened, setOpened] = useState(tab === 'versions');
  if (tab === 'versions' && !opened) setOpened(true);

  const count = task.versions.length;
  const onBdrc = task.versions.filter(isOnBdrc).length;
  const tabClass = (on: boolean) =>
    `${TAB} ${on ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center border-b border-gray-200 px-2">
        <div role="tablist" aria-label="Where to look" className="flex shrink-0">
          <button type="button" role="tab" aria-selected={tab === 'text'} onClick={() => onTabChange('text')} className={tabClass(tab === 'text')}>
            Text
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'versions'}
            onClick={() => onTabChange('versions')}
            className={`inline-flex items-center gap-2 ${tabClass(tab === 'versions')}`}
          >
            Versions
            <span className="rounded-full bg-blue-100 px-2 text-xs font-semibold tabular-nums text-blue-800">{count}</span>
          </button>
        </div>
        <span className="ml-auto truncate px-2 text-sm tabular-nums text-gray-500">
          {onBdrc} of {count} on BDRC
        </span>
      </div>

      {/* Hidden rather than removed, so going back to the text keeps the place in it. */}
      <div className={tab === 'text' ? 'min-h-0 flex-1' : 'hidden'}>{children}</div>
      {opened && (
        <div className={tab === 'versions' ? 'min-h-0 flex-1' : 'hidden'}>
          <Versions task={task} onSearchName={onSearchName} />
        </div>
      )}
    </div>
  );
}
