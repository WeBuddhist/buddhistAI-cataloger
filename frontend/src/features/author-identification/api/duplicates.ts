// Duplicate reports: two BDRC persons reported as one, kept in our backend. When one of them
// is a person of the text's answer, the other goes to BDRC with it (data.duplicate_p_ids).
import type { DuplicateDecision, DuplicateReport } from '../types';
import { request } from './tasks';

interface ApiReport {
  id: string;
  batch_id: string;
  item_id: number;
  text_title: string | null;
  reporter_name: string | null;
  person_id: string;
  person_name: string | null;
  person_dates: string | null;
  other_id: string;
  other_name: string | null;
  other_dates: string | null;
  reason: string;
  decision: DuplicateDecision | null;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  mine: boolean;
}

const utc = (iso: string) => (iso.endsWith('Z') ? iso : `${iso}Z`);

const person = (id: string, name: string | null, dates: string | null) => ({ id, nameBo: name ?? id, matchedName: null, dates });

function reportOf(r: ApiReport): DuplicateReport {
  const textId = `${r.batch_id}/${r.item_id}`;
  return {
    id: r.id,
    persons: [person(r.person_id, r.person_name, r.person_dates), person(r.other_id, r.other_name, r.other_dates)],
    reason: r.reason,
    text: { id: textId, title: r.text_title ?? textId },
    reportedBy: r.reporter_name ?? '',
    reportedAt: utc(r.created_at),
    decision:
      r.decision && r.decided_at
        ? { kind: r.decision, note: r.decision_note ?? '', by: r.decided_by_name ?? '', at: utc(r.decided_at) }
        : null,
    mine: r.mine,
  };
}

/** All reports, newest first. */
export async function fetchDuplicates(): Promise<DuplicateReport[]> {
  return (await request<ApiReport[]>('/duplicates')).map(reportOf);
}

/** Report two persons as one, noticed on a text ("1/5"). */
export async function reportDuplicate(report: Pick<DuplicateReport, 'persons' | 'reason' | 'text'>): Promise<DuplicateReport> {
  const [batchId, itemId] = report.text.id.split('/');
  const [a, b] = report.persons;
  const saved = await request<ApiReport>('/duplicates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch_id: batchId,
      item_id: Number(itemId),
      text_title: report.text.title,
      person: { id: a.id, name: a.nameBo, dates: a.dates },
      other: { id: b.id, name: b.nameBo, dates: b.dates },
      reason: report.reason,
    }),
  });
  return reportOf(saved);
}

/** An admin's decision; null opens the report again. */
export async function decideDuplicate(id: string, decision: { kind: DuplicateDecision; note: string } | null): Promise<void> {
  await request<ApiReport>(`/duplicates/${encodeURIComponent(id)}/decision`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: decision?.kind ?? null, note: decision?.note ?? '' }),
  });
}

/** Take back a report, while it is not decided. */
export async function removeDuplicate(id: string): Promise<void> {
  await request<void>(`/duplicates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
