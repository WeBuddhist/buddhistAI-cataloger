// Cataloger /dedup routes. Decisions are saved there first and synced to BDRC's
// review API in the background, so the UI never calls BDRC directly.
import { API_URL } from '@/config/api';
import { fetchWithAccessToken } from '@/lib/fetchWithAccessToken';

const BASE = `${API_URL}/dedup`;

export interface ReviewBatch {
  batch_id: string;
  kind: string;
  n_items: number;
  notes: string | null;
  created_at: string | null;
  // BDRC's counts for the whole batch, by status string.
  status_counts: Record<string, number>;
  my_open: number;
  my_done: number;
}

export interface WitnessCard {
  mw_id: string;
  title_bo?: string | null;
  author_name_bo?: string | null;
  p_id?: string | null;
  wa_id?: string | null;
  rep_id?: string | null;
  volume_id?: string | null;
  edition_type?: string | null;
  etext_source?: string | null;
  text_length?: number | null;
  image_url?: string | null;
  head?: string | null;
  tail?: string | null;
  snippet_source?: string | null;
}

export interface PairMetrics {
  jaccard?: number | null;
  containment?: number | null;
  shared?: number | null;
  schemes?: string[] | null;
  head_sim?: number | null;
  tail_sim?: number | null;
  title_lev?: number | null;
  author_lev?: number | null;
  wa_match?: boolean | null;
  same_rep?: boolean | null;
  same_root?: boolean | null;
  len_ratio?: number | null;
}

/** One AI model's reading of a pair. */
export interface LlmModelAnalysis {
  model?: string;
  label?: string | null;
  confidence?: number | null;
  rule?: string | null;
  explanation?: string | null;
  key_evidence?: string[] | null;
}

/** BDRC's AI reading of a pair (newer batches): the verdict, why, and each model's view. */
export interface LlmAnalysis {
  verdict?: string | null;
  /** `agree`, or `tiebreak` when the models differed and a third one decided. */
  agreement?: string | null;
  summary_bo?: string | null;
  summary_en?: string | null;
  models?: LlmModelAnalysis[] | null;
}

export interface PairEvidence {
  schema_version?: string;
  why?: string;
  metrics?: PairMetrics;
  llm_analysis?: LlmAnalysis | null;
  a?: WitnessCard;
  b?: WitnessCard;
}

export interface ReviewIssue {
  kind: string;
  mw_ids: string[];
  note?: string | null;
}

export interface ItemAssignment {
  // 1 or 2: each pair has two annotator slots.
  slot: number;
  assigned_at: string;
  first_opened_at: string | null;
  completed_at: string | null;
  active_seconds: number;
}

export interface ReviewItem {
  item_id: number;
  batch_id: string;
  kind: string;
  subject: { a_mw?: string; b_mw?: string } & Record<string, unknown>;
  evidence: PairEvidence;
  // 'new' until this user answers; then 'finalized' ('flagged' only on older issue-only answers).
  status: string;
  verdict: string | null;
  abstention_reason: string | null;
  confidence: number | null;
  issues: ReviewIssue[] | null;
  partner_payload: Record<string, unknown> | null;
  annotator_id: string | null;
  decided_at: string | null;
  // pending | running | succeeded | failed | superseded; null before any decision.
  sync_state: string | null;
  assignment: ItemAssignment | null;
  // 'single' (answer is final) or 'double' (two annotators, then an adjudicator if they disagree).
  review_mode: string;
  // Both annotators have answered, or an admin corrected the pair, so this answer can no longer change.
  locked: boolean;
  // An admin corrected the pair's final answer.
  corrected: boolean;
  // When the assignee last changed their answer, and how many times (saving the same
  // answer again is not a change). The first answer's time is assignment.completed_at.
  answer_changed_at: string | null;
  answer_changes: number;
}

// Adjudication: pairs whose two annotators disagreed (or either said "can't answer").

export interface AnnotatorAnswer {
  // "Annotator 1" / "Annotator 2": unnamed and shuffled for the adjudicator.
  label: string;
  verdict: string | null;
  abstention_reason: string | null;
  confidence: number | null;
  issues: ReviewIssue[] | null;
  partner_payload: Record<string, unknown> | null;
  decided_at: string | null;
  // Only filled in for admins.
  slot: number | null;
  annotator_id: string | null;
}

export interface AdjudicationInfo {
  created_at: string;
  adjudicator_id: string | null;
  reserved_at: string | null;
  first_opened_at: string | null;
  completed_at: string | null;
  // sided_with_1 | sided_with_2 | new_label | unresolved, once settled.
  resolution: string | null;
  active_seconds: number;
}

/** A disputed pair. `verdict`, `confidence`, … are this adjudicator's own answer. */
export interface AdjudicationItem extends ReviewItem {
  note: string | null;
  annotations: AnnotatorAnswer[];
  adjudication: AdjudicationInfo;
}

export interface AdjudicationInput extends DecisionInput {
  note?: string | null;
}

export interface ClaimResult {
  // New items handed out by this call; 0 when the user still had unfinished ones.
  claimed: number;
  items: ReviewItem[];
}

export type MyItemsState = 'open' | 'done' | 'all';

// The backend fills in status, annotator_id and decided_at; fields left out keep their
// value. `issues` without a verdict only works once the item has one.
export interface DecisionInput {
  verdict?: string | null;
  abstention_reason?: string | null;
  confidence?: number | null;
  issues?: ReviewIssue[] | null;
  partner_payload?: Record<string, unknown> | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  // FormData sets its own multipart content-type (with the boundary).
  if (init?.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetchWithAccessToken(`${BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      // non-JSON error body
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function fetchBatches(opts?: { signal?: AbortSignal }) {
  return request<ReviewBatch[]>('/batches', { signal: opts?.signal });
}

// Without a batch, the backend picks the oldest batch that still has work.
const batchPath = (batchId?: string) => (batchId ? `/batches/${encodeURIComponent(batchId)}` : '');

export function claimItems(batchId?: string) {
  return request<ClaimResult>(`${batchPath(batchId)}/claim`, { method: 'POST' });
}

export function fetchMyItems(state: MyItemsState, batchId?: string, opts?: { signal?: AbortSignal }) {
  return request<ReviewItem[]>(`${batchPath(batchId)}/my-items?state=${state}`, { signal: opts?.signal });
}

export function fetchItem(itemId: number, opts?: { signal?: AbortSignal }) {
  return request<ReviewItem>(`/items/${itemId}`, { signal: opts?.signal });
}

/** Monlam's id for one transcription, kept with the recording to trace it. */
export interface SttRequest {
  request_id: string | null;
  model_id: string | null;
}

/** Text of one recording (Monlam STT, through the Cataloger backend). Nothing is stored. */
export async function transcribeVoiceNote(audio: Blob) {
  const form = new FormData();
  form.append('file', audio, 'note.wav');
  return request<{ text: string } & SttRequest>('/notes/transcribe', { method: 'POST', body: form });
}

/** Keep a saved note's recording (S3). Returns the id the note stores as `voice_note_id`. */
export async function saveVoiceNote(itemId: number, audio: Blob, sttRequests: SttRequest[]) {
  const form = new FormData();
  form.append('file', audio, 'note.wav');
  form.append('stt_requests', JSON.stringify(sttRequests));
  const { id } = await request<{ id: string }>(`/items/${itemId}/voice-notes`, { method: 'POST', body: form });
  return id;
}

/** A short-lived link to play a note's recording. */
export async function fetchVoiceNoteUrl(voiceNoteId: string) {
  const { url } = await request<{ url: string }>(`/voice-notes/${encodeURIComponent(voiceNoteId)}/audio`);
  return url;
}

/** `keepalive` lets the request finish while the page is closing. */
export async function addActiveTime(itemId: number, seconds: number, keepalive = false) {
  await fetchWithAccessToken(`${BASE}/items/${itemId}/active-time`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seconds }),
    keepalive,
  });
}

export function saveDecision(itemId: number, body: DecisionInput) {
  return request<ReviewItem>(`/items/${itemId}/decision`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchAdjudicationQueue(state: MyItemsState, opts?: { signal?: AbortSignal }) {
  return request<AdjudicationItem[]>(`/adjudication/items?state=${state}`, { signal: opts?.signal });
}

/** Opening a disputed pair takes it, if nobody has yet. */
export function fetchAdjudicationItem(itemId: number, opts?: { signal?: AbortSignal }) {
  return request<AdjudicationItem>(`/adjudication/items/${itemId}`, { signal: opts?.signal });
}

export function saveAdjudication(itemId: number, body: AdjudicationInput) {
  return request<AdjudicationItem>(`/adjudication/items/${itemId}/decision`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** A pair as the read-only shared page shows it: evidence only, never an answer. Opens
 * for any logged-in account. */
export interface SharedPair {
  item_id: number;
  batch_id: string;
  kind: string;
  subject: { a_mw?: string; b_mw?: string } & Record<string, unknown>;
  evidence: PairEvidence;
}

export function fetchPair(itemId: number, opts?: { signal?: AbortSignal }) {
  return request<SharedPair>(`/pairs/${itemId}`, { signal: opts?.signal });
}

/** Where a text sits in a volume BDRC lists; all empty when BDRC gives no position. */
export interface TextSource {
  source_volume_id: string | null;
  source_cstart: number | null;
  source_cend: number | null;
}

export interface PairSources {
  a: TextSource;
  b: TextSource;
}

export function fetchPairSources(itemId: number, opts?: { signal?: AbortSignal }) {
  return request<PairSources>(`/pairs/${itemId}/sources`, { signal: opts?.signal });
}

// Full text and diff: read-only, passed through from BDRC.

export interface FullText {
  mw_id: string;
  title_bo: string | null;
  author_name_bo: string | null;
  rep_id: string | null;
  volume_id: string | null;
  image_url: string | null;
  etext_source: string | null;
  text_length: number | null;
  text_bo: string;
}

export type DiffGranularity = 'syllable' | 'char' | 'line';

// Compact chunks, led by an op: [0, text] same in both, [1, a, b] replaced,
// [2, text] only in A, [3, text] only in B. A changed chunk may end with a difference
// type (decoded by TextDiff.types, e.g. 1 = punctuation only).
export type DiffChunk =
  | [0, string]
  | [1, string, string, number?]
  | [2, string, number?]
  | [3, string, number?];

export interface TextDiff {
  a: { mw_id: string; title_bo: string | null; image_url: string | null };
  b: { mw_id: string; title_bo: string | null; image_url: string | null };
  granularity: DiffGranularity;
  // 0..1
  ratio: number;
  // Difference-type legend, e.g. {"0": "none", "1": "punctuation"}.
  types?: Record<string, string>;
  diff: DiffChunk[];
}

export function fetchText(mwId: string, opts?: { signal?: AbortSignal }) {
  return request<FullText>(`/texts/${encodeURIComponent(mwId)}`, { signal: opts?.signal });
}

export function fetchDiff(a: string, b: string, granularity: DiffGranularity = 'syllable', opts?: { signal?: AbortSignal }) {
  const q = new URLSearchParams({ a, b, granularity });
  return request<TextDiff>(`/diff?${q}`, { signal: opts?.signal });
}

// Admin (role admin).

export interface WorkCounts {
  assigned: number;
  done: number;
  in_progress: number;
  not_started: number;
}

export interface AdminBatch {
  batch_id: string;
  n_items: number;
  created_at: string | null;
  status_counts: Record<string, number>;
  assigned: number;
  assigned_done: number;
  // Distinct pairs handed out to at least one annotator.
  pairs_handed_out: number;
}

export interface SyncHealth {
  counts: Record<string, number>;
  failed: { decision_id: string; item_id: number; user_id: string; attempts: number; last_error: string | null; updated_at: string | null }[];
}

export interface DoubleReviewCounts {
  awaiting_second: number;
  both_answered: number;
  agreed: number;
  adjudication_waiting: number;
  adjudication_in_progress: number;
  adjudicated: number;
  resolutions: Record<string, number>;
}

export interface AdminOverview {
  totals: WorkCounts;
  batches: AdminBatch[];
  verdicts: Record<string, number>;
  abstention_reasons: Record<string, number>;
  issues: Record<string, number>;
  sync: SyncHealth;
  double_review: DoubleReviewCounts;
}

export interface Annotator extends WorkCounts {
  user_id: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  // admin | reviewer (shown as "Adjudicator") | annotator
  role: string | null;
  has_access: boolean;
  total_active_seconds: number;
  avg_active_seconds: number | null;
  // Part of the total: time on the pairs this person adjudicated.
  adjudication_active_seconds: number;
  // Average per pair this person settled as adjudicator.
  avg_adjudication_seconds: number | null;
  last_active: string | null;
  // Double-review pairs where both annotators answered, and how many of those agreed.
  paired: number;
  agreed: number;
  // Of those, the ones that went to adjudication; and of the settled ones where this
  // person gave Same or Different, how many ended with their answer (upheld of upheld_of).
  disputed: number;
  upheld: number;
  upheld_of: number;
  // Answered pairs where this person left a note.
  notes: number;
  // Pairs this person settled as adjudicator, their final answers by verdict, and how
  // many of those decisions carry a note.
  adjudicated: number;
  adjudication_answers: Record<string, number>;
  adjudication_notes: number;
  // Pairs whose answer this person changed after first answering (in the period, if chosen).
  changed: number;
  // Their own current answer per pair, counted by verdict (same, different, contains, …).
  answers: Record<string, number>;
}

export interface AdminAdjudication {
  item_id: number;
  batch_id: string;
  title_a: string | null;
  title_b: string | null;
  created_at: string;
  adjudicator_id: string | null;
  adjudicator_name: string | null;
  reserved_at: string | null;
  completed_at: string | null;
  resolution: string | null;
  verdict: string | null;
  annotations: AnnotatorAnswer[];
}

export interface ReassignResult {
  moved: number[];
  skipped: number[];
}

/** A period as ISO instants (`until` excluded); both unset means all time. */
export interface PeriodRange {
  since?: string;
  until?: string;
}

function periodQuery(period: PeriodRange | undefined, params = new URLSearchParams()): string {
  if (period?.since) params.set('since', period.since);
  if (period?.until) params.set('until', period.until);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function fetchAdminOverview(period?: PeriodRange, opts?: { signal?: AbortSignal }) {
  return request<AdminOverview>(`/admin/overview${periodQuery(period)}`, { signal: opts?.signal });
}

export function fetchAnnotators(period?: PeriodRange, opts?: { signal?: AbortSignal }) {
  return request<Annotator[]>(`/admin/annotators${periodQuery(period)}`, { signal: opts?.signal });
}

/** With a period, only the pairs answered in it. */
export function fetchAnnotatorItems(
  userId: string,
  state: MyItemsState,
  period?: PeriodRange,
  opts?: { signal?: AbortSignal },
) {
  const query = periodQuery(period, new URLSearchParams({ state }));
  return request<ReviewItem[]>(`/admin/annotators/${encodeURIComponent(userId)}/items${query}`, {
    signal: opts?.signal,
  });
}

/** `toUserId` null releases the items back to the pool. `fromUserId` picks whose slot
 * moves, since a pair has two. */
export function reassignItems(itemIds: number[], toUserId: string | null, fromUserId?: string) {
  return request<ReassignResult>('/admin/reassign', {
    method: 'POST',
    body: JSON.stringify({ item_ids: itemIds, to_user_id: toUserId, from_user_id: fromUserId ?? null }),
  });
}

export type ReviewMode = 'single' | 'double';

/** Deduplicator-wide settings. `review_mode`: how pairs handed out from now on are reviewed. */
export interface DedupSettings {
  review_mode: ReviewMode;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

export function fetchSettings(opts?: { signal?: AbortSignal }) {
  return request<DedupSettings>('/admin/settings', { signal: opts?.signal });
}

export function updateSettings(reviewMode: ReviewMode) {
  return request<DedupSettings>('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ review_mode: reviewMode }),
  });
}

export function fetchAdminAdjudications(state: MyItemsState, opts?: { signal?: AbortSignal }) {
  return request<AdminAdjudication[]>(`/admin/adjudications?state=${state}`, { signal: opts?.signal });
}

/** `toUserId` null puts the pairs back in the queue for any adjudicator. */
export function reassignAdjudications(itemIds: number[], toUserId: string | null) {
  return request<ReassignResult>('/admin/adjudications/reassign', {
    method: 'POST',
    body: JSON.stringify({ item_ids: itemIds, to_user_id: toUserId }),
  });
}

// Correcting a pair (admin pair page). The shared /dedup/pair/:id page never shows answers.

export interface DecisionHistory {
  user_id: string;
  user_name: string | null;
  // annotator | adjudicator | admin_correction
  role: string;
  slot: number | null;
  is_final: boolean;
  verdict: string | null;
  abstention_reason: string | null;
  confidence: number | null;
  issues: ReviewIssue[] | null;
  partner_payload: Record<string, unknown> | null;
  note: string | null;
  decided_at: string;
  sync_state: string;
}

export interface AdminPair extends SharedPair {
  review_mode: string;
  // False for a pair BDRC has but nobody has been handed yet.
  handed_out: boolean;
  final: DecisionHistory | null;
  // Every answer saved on the pair, oldest first.
  history: DecisionHistory[];
  corrected: boolean;
}

export interface CorrectionInput extends DecisionInput {
  note?: string | null;
}

export function fetchAdminPair(itemId: number, opts?: { signal?: AbortSignal }) {
  return request<AdminPair>(`/admin/pairs/${itemId}`, { signal: opts?.signal });
}

/** Makes the admin's answer the pair's final answer; pushed to BDRC in the background. */
export function correctPair(itemId: number, body: CorrectionInput) {
  return request<AdminPair>(`/admin/pairs/${itemId}/correction`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface AdminPairRow {
  item_id: number;
  batch_id: string;
  title_a: string | null;
  title_b: string | null;
  review_mode: string;
  // The current final answer; all null while the pair has none.
  verdict: string | null;
  abstention_reason: string | null;
  answered_by: string | null;
  answered_by_name: string | null;
  answered_role: string | null;
  decided_at: string | null;
  sync_state: string | null;
  corrected: boolean;
  annotator_names: string[];
}

export type PairSort = 'newest' | 'oldest' | 'id_desc' | 'id_asc';

export interface PairFilters {
  batch_id?: string;
  // An answer, or 'none' for pairs with no final answer yet.
  verdict?: string;
  annotator_id?: string;
  corrected?: boolean;
  // A pair number, or part of an MW id or a title.
  q?: string;
  sort?: PairSort;
  offset?: number;
  limit?: number;
}

export function fetchAdminPairs(filters: PairFilters, opts?: { signal?: AbortSignal }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') q.set(k, String(v));
  return request<{ total: number; rows: AdminPairRow[] }>(`/admin/pairs?${q}`, { signal: opts?.signal });
}
