// Small helpers shared by the admin pages.
import { tr } from '../i18n';

/** A time from the backend (UTC, maybe without a zone) as a Date. */
export const utc = (iso: string) => new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);

/** Hours and minutes, in the language chosen: "2 h 05 min", "45 min". */
export function spent(minutes: number): string {
  if (minutes < 60) return tr('overview.minutes', { m: minutes });
  return tr('overview.hours', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') });
}

/** Grey for 0, so a table of zeros still reads as a table. */
export const tone = (n: number, color = 'text-gray-900') => (n ? color : 'text-gray-400');
