// MOCK: reports stay in this browser, beside one sample. Nothing is sent anywhere. When the
// endpoints exist, only this file changes.
import { SAMPLE_REPORT } from '../sample/duplicates';
import type { DuplicateDecision, DuplicateReport } from '../types';

const STORE = 'author-identification:sample-duplicates';

function read(): DuplicateReport[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    return Array.isArray(saved) ? (saved as DuplicateReport[]) : [SAMPLE_REPORT];
  } catch {
    return [SAMPLE_REPORT];
  }
}

const write = (reports: DuplicateReport[]) => localStorage.setItem(STORE, JSON.stringify(reports));

/** All reports, newest first. */
export async function fetchDuplicates(): Promise<DuplicateReport[]> {
  return read().sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

export async function reportDuplicate(report: Omit<DuplicateReport, 'id' | 'reportedAt' | 'decision'>): Promise<DuplicateReport> {
  const saved: DuplicateReport = {
    ...report,
    id: `report-${Date.now()}`,
    reportedAt: new Date().toISOString(),
    decision: null,
  };
  write([...read(), saved]);
  return saved;
}

/** Null opens the report again. */
export async function decideDuplicate(
  id: string,
  decision: { kind: DuplicateDecision; note: string; by: string } | null,
): Promise<void> {
  const at = new Date().toISOString();
  write(read().map((r) => (r.id === id ? { ...r, decision: decision && { ...decision, at } } : r)));
}

export async function removeDuplicate(id: string): Promise<void> {
  write(read().filter((r) => r.id !== id));
}

/** Only for trying the tool: back to the one sample report. */
export async function clearSampleReports(): Promise<void> {
  localStorage.removeItem(STORE);
}
