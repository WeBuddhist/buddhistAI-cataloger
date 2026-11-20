import { useState } from 'react';

const KEY = 'dedup.admin.showStats';

function saved(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

/** Whether a person's admin page shows their stats (cards, sentences, chart). Off by
 * default, so the pairs list comes first; the choice is kept for next time. */
export function useShowStats(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(saved);
  const set = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // Only a convenience.
    }
  };
  return [on, set];
}
