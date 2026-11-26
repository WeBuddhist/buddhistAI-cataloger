// Texts are BDRC's (batch items and editions, read through our backend, which holds the
// BDRC password). Answers stay in this browser until the answer form saves them.
import { API_URL } from '@/config/api';
import { fetchWithAccessToken } from '@/lib/fetchWithAccessToken';
import type { AuthorAnswer, AuthorTask, ExtractedName, SavedAnswer, TaskSummary, TextVersion } from '../types';
import { cleanName, findName, hasTibetan, wylieToTibetan } from '../utils';

const BASE = `${API_URL}/author-identification`;

/** The batch handed out to annotators. Batch 1 is the first. */
export const BATCH_ID = '1';

// BDRC caps a page of items at 500.
const PAGE = 500;

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

async function request<T>(path: string): Promise<T> {
  const res = await fetchWithAccessToken(`${BASE}${path}`);
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

/** My texts, in batch order. */
export async function fetchTasks(): Promise<TaskSummary[]> {
  const items: ApiItem[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await request<{ total: number; items: ApiItem[] }>(
      `/batches/${BATCH_ID}/items?offset=${offset}&limit=${PAGE}`,
    );
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= page.total) break;
  }
  const answers = readAnswers();
  return items.map((item) => {
    const id = String(item.item_id);
    return {
      id,
      title: tibetan(item.edition?.title_bo) ?? item.edition_id,
      versionCount: item.edition?.n_witnesses ?? 0,
      extractedNames: namesOf(item.edition?.persons, item.author_names),
      answer: answers[id] ?? null,
    };
  });
}

/** One text of the batch, with its whole text and its versions. */
export async function fetchTask(id: string): Promise<AuthorTask> {
  if (!/^\d+$/.test(id)) throw new Error('Text not found');
  const item = await request<ApiItem>(`/batches/${BATCH_ID}/items/${id}`);
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
    title: tibetan(edition.title_bo ?? item.edition?.title_bo) ?? edition.edition_id,
    content,
    versions,
    extractedNames: [...inText, ...names],
  };
}

// --- answers: in this browser until the answer form sends them --------------------

const STORE = `author-identification:answers-batch-${BATCH_ID}`;

type Answers = Record<string, SavedAnswer | undefined>;

function readAnswers(): Answers {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

const writeAnswers = (answers: Answers) => localStorage.setItem(STORE, JSON.stringify(answers));

export async function saveAnswer(taskId: string, answer: AuthorAnswer): Promise<SavedAnswer> {
  const saved: SavedAnswer = { ...answer, savedAt: new Date().toISOString() };
  writeAnswers({ ...readAnswers(), [taskId]: saved });
  return saved;
}

/** Take an answer back: the text is to do again. */
export async function removeAnswer(taskId: string): Promise<void> {
  const answers = readAnswers();
  delete answers[taskId];
  writeAnswers(answers);
}

/** Only while answers stay in this browser: every text is to do again. */
export async function clearSampleAnswers(): Promise<void> {
  localStorage.removeItem(STORE);
}
