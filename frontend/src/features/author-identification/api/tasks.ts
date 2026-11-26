// Texts are BDRC's (batch items and editions, read through our backend, which holds the
// BDRC password); my texts are those "Assign work" handed me. Answers are saved in our
// backend, which sends them on to BDRC.
import { API_URL } from '@/config/api';
import { fetchWithAccessToken } from '@/lib/fetchWithAccessToken';
import type { AuthorAnswer, AuthorTask, ExtractedName, SavedAnswer, TaskSummary, TextVersion } from '../types';
import { isSkipReason } from '../guidelines';
import { cleanName, findName, hasTibetan, wylieToTibetan } from '../utils';

const BASE = `${API_URL}/author-identification`;

/** A name in the texts, as BDRC's editions API gives it, with the versions it is in. */
interface ApiPerson {
  name_bo: string | null;
  evidence?: { names?: { name: string; witnesses?: string[] }[] } | null;
}

interface ApiItem {
  item_id: number;
  edition_id: string;
  edition: { title_bo: string | null; n_witnesses: number; persons?: ApiPerson[] } | null;
  author_names?: string[];
}

interface ApiVersion {
  mw_id: string;
  role: string;
  root_mw_id: string | null;
  title_bo: string | null;
  bdrc_title_bo: string | null;
  collection_title_bo: string | null;
  author_name_bo: string | null;
  image_url: string | null;
}

interface ApiEdition {
  edition_id: string;
  title_bo: string | null;
  base_mw_id: string;
  text_bo: string | null;
  persons?: ApiPerson[];
  versions?: ApiVersion[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAccessToken(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      /* not JSON */
    }
    if (res.status === 404) detail = 'Text not found';
    if (res.status === 410) detail = 'This text was replaced by a newer one at BDRC';
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Each name found, once per version it is in; the item's names when BDRC gives no versions. */
function namesOf(persons: ApiPerson[] = [], fallback: string[] = []): ExtractedName[] {
  const names: ExtractedName[] = [];
  for (const p of persons) {
    let found = p.evidence?.names ?? [];
    if (found.length === 0 && p.name_bo) found = [{ name: p.name_bo, witnesses: [] }];
    for (const { name, witnesses = [] } of found) {
      if (witnesses.length === 0) names.push({ name, confidence: null, versionId: null, evidence: null });
      for (const w of witnesses) names.push({ name, confidence: null, versionId: w, evidence: null });
    }
  }
  if (names.length > 0) return names;
  return fallback.map((name) => ({ name, confidence: null, versionId: null, evidence: null }));
}

/** Some titles come in Wylie; BDRC's site shows them in Tibetan script, and so do we. */
function tibetan(text: string | null | undefined): string | null {
  if (!text) return null;
  return hasTibetan(text) ? text : wylieToTibetan(text);
}

// Versions cut out of a volume by the Outliner have a code after their collection's id
// ("MW8517_5d918883-…") and no BDRC page of their own; their collection has one.
const ownBdrcId = (mwId: string) => (mwId.includes('-') ? null : mwId);

function versionOf(v: ApiVersion): TextVersion {
  return {
    id: v.mw_id,
    bdrcId: ownBdrcId(v.mw_id),
    collection: v.root_mw_id ? { name: v.collection_title_bo ?? v.root_mw_id, bdrcId: v.root_mw_id } : null,
    title: tibetan(v.bdrc_title_bo ?? v.title_bo),
    nameInVersion: v.author_name_bo,
    scansUrl: v.image_url,
    base: v.role === 'base',
  };
}

/** One of my texts, as our backend lists it, with BDRC's item. */
interface ApiMyText {
  batch_id: string;
  item_id: number;
  assigned_at: string;
  completed_at: string | null;
  item: ApiItem | null;
  answer: ApiAnswer | null;
}

/** A text's id here: its BDRC batch and item ("1/5"), as in its address. */
const textIdOf = (batchId: string, itemId: number | string) => `${batchId}/${itemId}`;

/** My texts (handed to me by "Assign work"), in the order they were given. */
export async function fetchTasks(): Promise<TaskSummary[]> {
  const mine = await request<ApiMyText[]>('/my-texts');
  return mine.map(({ batch_id, item_id, completed_at, item, answer }) => {
    const id = textIdOf(batch_id, item_id);
    return {
      id,
      editionId: item?.edition_id ?? '',
      authorNames: item?.author_names ?? [],
      title: tibetan(item?.edition?.title_bo) ?? item?.edition_id ?? id,
      versionCount: item?.edition?.n_witnesses ?? 0,
      extractedNames: namesOf(item?.edition?.persons, item?.author_names),
      answer: savedOf(answer),
      completed: completed_at != null,
    };
  });
}

/** Give me my next texts (5); none while I still have texts to finish. */
export async function claimTexts(): Promise<{ claimed: number }> {
  return request<{ claimed: number }>('/claim', { method: 'POST' });
}

/** One text of the batch, with its whole text and its versions. */
export async function fetchTask(id: string, known?: Pick<TaskSummary, 'editionId' | 'title' | 'authorNames'>): Promise<AuthorTask> {
  const [, batchId, itemId] = /^([A-Za-z0-9._-]{1,80})\/(\d+)$/.exec(id) ?? [];
  if (!batchId) throw new Error('Text not found');
  // From "My texts" the text's BDRC id is known: one request (of about 4 s) less.
  const item: Pick<ApiItem, 'edition_id' | 'author_names'> & { title?: string | null } = known
    ? { edition_id: known.editionId, author_names: known.authorNames, title: known.title }
    : await request<ApiItem>(`/batches/${encodeURIComponent(batchId)}/items/${itemId}`).then((i) => ({ ...i, title: i.edition?.title_bo }));
  const edition = await request<ApiEdition>(`/editions/${encodeURIComponent(item.edition_id)}`);
  const content = edition.text_bo ?? '';
  const versions = (edition.versions ?? []).map(versionOf);
  const names = namesOf(edition.persons, item.author_names);
  // A name that is also in the text itself can be shown there, as it is written there.
  const inText = [...new Set(names.map((n) => cleanName(n.name)))].flatMap((name): ExtractedName[] => {
    const written = findName(content, name);
    return written ? [{ name, confidence: null, versionId: null, evidence: written }] : [];
  });
  return {
    id,
    editionId: edition.edition_id,
    title: tibetan(edition.title_bo ?? item.title) ?? edition.edition_id,
    content,
    versions,
    extractedNames: [...inText, ...names],
  };
}

// --- answers: saved in our backend, which sends them on to BDRC ----------------------

/** An answer as our backend saved it. */
interface ApiAnswer {
  person_answer: 'bdrc' | 'not_in_bdrc' | 'unknown' | null;
  p_id: string | null;
  name_bo: string | null;
  confidence: number | null;
  note: string | null;
  text_rejected: boolean;
  reject_reason: string | null;
  data: { person_name?: string } | null;
  decided_at: string;
}

/** Back to the form's shape; null for an answer this tool does not know how to show. */
function savedOf(a: ApiAnswer | null | undefined): SavedAnswer | null {
  if (!a) return null;
  const base = { note: a.note ?? '', savedAt: a.decided_at.endsWith('Z') ? a.decided_at : `${a.decided_at}Z` };
  if (a.text_rejected) return isSkipReason(a.reject_reason) ? { ...base, kind: 'skipped', reason: a.reject_reason } : null;
  if (a.person_answer === 'unknown') return { ...base, kind: 'skipped', reason: 'author_unknown' };
  if (a.person_answer === 'bdrc' && a.p_id) {
    return { ...base, kind: 'person', personId: a.p_id, name: a.data?.person_name ?? a.p_id, confidence: a.confidence ?? 0 };
  }
  if (a.person_answer === 'not_in_bdrc') return { ...base, kind: 'not_in_bdrc', name: a.name_bo ?? '', confidence: a.confidence ?? 0 };
  return null;
}

/** The answer as BDRC's editions API takes it (our backend adds who answered). */
function bodyOf(answer: AuthorAnswer, editionId: string) {
  const note = answer.note.trim() || null;
  if (answer.kind === 'skipped') {
    return answer.reason === 'author_unknown'
      ? { edition_id: editionId, person_answer: 'unknown', note }
      : { edition_id: editionId, text_rejected: true, reject_reason: answer.reason, note };
  }
  if (answer.kind === 'person') {
    // The person's name is kept with the answer so it shows without asking BDRC again.
    return { edition_id: editionId, person_answer: 'bdrc', p_id: answer.personId, confidence: answer.confidence, note, data: { person_name: answer.name } };
  }
  return { edition_id: editionId, person_answer: 'not_in_bdrc', name_bo: answer.name, confidence: answer.confidence, note };
}

/** Save my answer on a text ("1/5"). Our backend keeps it and sends it to BDRC. */
export async function saveAnswer(taskId: string, editionId: string, answer: AuthorAnswer): Promise<SavedAnswer> {
  const [batchId, itemId] = taskId.split('/');
  const saved = await request<ApiAnswer>(`/batches/${encodeURIComponent(batchId)}/items/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyOf(answer, editionId)),
  });
  return savedOf(saved) ?? { ...answer, savedAt: new Date().toISOString() };
}
