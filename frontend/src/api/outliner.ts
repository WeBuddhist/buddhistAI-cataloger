import { API_URL, OUTLINER_BASE_URL } from '@/config/api';
import type { TextSegment } from '@/features/outliner/types';
import { segmentBodyFromDocument, withResolvedSegmentTexts } from '@/lib/outlinerSegmentText';
import { fetchWithAccessToken, setAccessTokenGetter } from '@/lib/fetchWithAccessToken';

/** Register how to obtain the Auth0 access token for outliner API calls (set from the Auth0 provider tree). */
export function setOutlinerAccessTokenGetter(
  fn: (() => Promise<string | null>) | null,
  extras?: { refreshToken?: () => Promise<string | null>; logout?: () => void | Promise<void> }
) {
  setAccessTokenGetter(fn, extras);
}

/** Same as `fetch` but adds `Authorization: Bearer` when a getter is registered. */
export async function outlinerFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetchWithAccessToken(input, init);
}

// ==================== Types ====================

export type OutlineDocumentStatus =
  | 'completed'
  | 'active'
  | 'rejected'
  | 'approved'
  | 'deleted'
  | 'skipped';
export type OutlineSegmentStatus="checked"|"unchecked"|"approved"|"rejected";
export interface OutlinerDocument {
  id: string;
  status?:OutlineDocumentStatus;
  content: string;
  filename?: string | null;
  user_id?: string | null;
  total_segments: number;
  annotated_segments: number;
  progress_percentage: number;
  created_at: string;
  updated_at: string;
  segments?: OutlinerSegment[];
}

/** GET …/documents/:id/ai-toc-entries (AI / stored TOC entries) */
export interface AiTocEntryItem {
  page_no: number;
  title: string;
}

export interface OutlinerDocumentAiTocEntries {
  entries: AiTocEntryItem[];
}

/** From GET …/documents: set only when document is approved/completed and a segment is still rejected. */
export interface RejectedSegmentListNotice {
  message: string;
  document_id: string;
  segment_id: string;
  reviewer_user: { name?: string | null; picture?: string | null } | null;
}

export interface OutlinerDocumentListItem {
  id: string;
  filename?: string | null;
  user_id?: string | null;
  reviewer_id?: string | null;
  /** Assigned document reviewer when reviewer_id is set. */
  reviewer_user?: { name?: string | null; picture?: string | null } | null;
  total_segments: number;
  annotated_segments: number;
  progress_percentage: number;
  checked_segments: number;
  unchecked_segments: number;
  status?: OutlineDocumentStatus | null;
  created_at: string;
  updated_at: string;
  /** Most recent reviewer rejection in this document; use for annotator notices. */
  rejected_segment?: RejectedSegmentListNotice | null;
  /**
   * Reviewer rejection was addressed: a segment is checked, latest rejection has a reviewer
   * and is marked resolved. Shown on reviewer-facing document lists.
   */
  rejection_resolved?: boolean;
  /** Segments the reviewer split/merged or added during review. */
  reviewer_changed_segments?: number;
  /** Segments currently in rejected status (admin list). */
  rejection_count?: number;
  /** Total rejection comment rows on this document (admin list). */
  rejection_comment_count?: number;
  /**
   * Segments with rejection history not yet checked/approved. When 0 and rejection_comment_count > 0,
   * every segment tied to a rejection is checked or approved.
   */
  rejection_open_segment_count?: number;
}

export interface MyReviewedSegmentsDocumentGroup {
  document_id: string;
  filename: string;
  approved_count: number;
}

export interface MyReviewedSegmentsResponse {
  groups: MyReviewedSegmentsDocumentGroup[];
  total_approved_segments: number;
  total_groups: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

export type SegmentLabel = 'FRONT_MATTER' | 'TOC' | 'TEXT' | 'BACK_MATTER';

/** Latest reviewer on a segment rejection (from users table). */
export interface SegmentRejectionReviewer {
  user_id: string;
  name?: string | null;
  picture?: string | null;
}

/**
 * A stretch of wrong text a reviewer marked while rejecting a segment.
 * Offsets are document-absolute so a mark survives the segment being split.
 */
export interface MarkedSpan {
  start: number;
  end: number;
  note?: string | null;
}

/** Bundled rejection info on segment payloads (document GET + segment CRUD). */
export interface SegmentRejection {
  count: number;
  reason?: string | null;
  reviewer?: SegmentRejectionReviewer | null;
  /** True after annotator saves the segment while it was rejected (latest rejection row). */
  resolved?: boolean | null;
  /** From the latest rejection; only present while status is rejected. */
  marked_spans?: MarkedSpan[] | null;
  /** Reviewer's title/author suggestion when rejecting; only present while status is rejected. */
  reviewer_title?: string | null;
  reviewer_author?: string | null;
}

/** One historical rejection row (GET …/segments/:id/rejections). */
export interface SegmentRejectionHistoryItem {
  id: string;
  created_at: string;
  reason?: string | null;
  resolved?: boolean | null;
  reviewer?: SegmentRejectionReviewer | null;
  marked_spans?: MarkedSpan[] | null;
  reviewer_title?: string | null;
  reviewer_author?: string | null;
}

export interface SegmentRejectionHistoryResponse {
  items: SegmentRejectionHistoryItem[];
}

export interface OutlinerSegment {
  id: string;
  /** Resolved client-side from document.content + spans when omitted by API */
  text?: string;
  segment_index: number;
  span_start: number;
  span_end: number;
  title?: string | null;
  author?: string | null;
  title_span_start?: number | null;
  title_span_end?: number | null;
  updated_title?: string | null;
  author_span_start?: number | null;
  author_span_end?: number | null;
  updated_author?: string | null;
  reviewer_title?: string | null;
  reviewer_author?: string | null;
  title_bdrc_id?: string | null;
  author_bdrc_id?: string | null;
  parent_segment_id?: string | null;
  is_annotated: boolean;
  is_attached?: boolean | null;
  status?: OutlineSegmentStatus | null;
  label?: SegmentLabel | null;
  rejection?: SegmentRejection | null;
  is_supplied_title?: boolean | null;
  created_at: string;
  updated_at: string;
  comments: Comment[];
  /** Set when the reviewer added this segment during review; null = the annotator's. */
  created_by_id?: string | null;
  /** The reviewer split/merged this annotator segment. */
  corrected_by_reviewer?: boolean | null;
}

export interface DocumentCreateRequest {
  content: string;
  filename?: string;
}

export interface SegmentCreateRequest {
  text?: string; // Optional - backend will extract from document if not provided
  segment_index: number;
  span_start: number;
  span_end: number;
  title?: string;
  author?: string;
  title_bdrc_id?: string;
  author_bdrc_id?: string;
  parent_segment_id?: string;
}

export interface Comment {
  content: string;
  username: string;
  timestamp: string;
}

export interface CommentsData {
  comments: Comment[];
}

export interface SegmentUpdateRequest {
  text?: string;
  title?: string;
  author?: string;
  title_span_start?: number | null;
  title_span_end?: number | null;
  updated_title?: string | null;
  author_span_start?: number | null;
  author_span_end?: number | null;
  updated_author?: string | null;
  title_bdrc_id?: string;
  author_bdrc_id?: string;
  parent_segment_id?: string;
  is_attached?: boolean;
  status?: OutlineSegmentStatus; // checked, unchecked
  label?: SegmentLabel; // FRONT_MATTER, TOC, TEXT, BACK_MATTER
  comment?: string | CommentsData | Comment[]; // Can be old string format, CommentsData format, or array format
  comment_content?: string; // New comment content to append
  comment_username?: string; // Username for new comment
  is_supplied_title?: boolean; // Title supplied by annotator (not from source)
  reviewer_title?: string | null;
  reviewer_author?: string | null;
}

export interface BulkSegmentUpdateRequest {
  segments: SegmentUpdateRequest[];
  segment_ids: string[];
}

export interface BulkSegmentOperationsRequest {
  create?: SegmentCreateRequest[];
  update?: Array<{ id: string } & Partial<SegmentUpdateRequest & { span_start?: number; span_end?: number; segment_index?: number }>>;
  delete?: string[];
}

export interface SplitSegmentRequest {
  segment_id: string;
  split_position: number;
}

export interface MergeSegmentsRequest {
  segment_ids: string[];
}

export interface DocumentProgress {
  document_id: string;
  total_segments: number;
  annotated_segments: number;
  checked_segments: number;
  unchecked_segments: number;
  progress_percentage: number;
  updated_at: string;
}

// ==================== Helper Functions ====================

const handleApiResponse = async (response: Response): Promise<any> => {
  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    let errorMessage = 'An error occurred';

    if (contentType && contentType.includes('application/json')) {
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }
    }

    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await response.json();
  }
  return null;
};

// ==================== Document Endpoints ====================

export const createOutlinerDocument = async (
  data: DocumentCreateRequest
): Promise<OutlinerDocument> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return handleApiResponse(response);
};





export const getOutlinerDocument = async (
  documentId: string,
  includeSegments: boolean = true,
  options?: { workspace?: boolean }
): Promise<OutlinerDocument> => {
  const params = new URLSearchParams();
  params.set('include_segments', String(includeSegments));
  const path = options?.workspace
    ? `${OUTLINER_BASE_URL}/documents/${documentId}/workspace`
    : `${OUTLINER_BASE_URL}/documents/${documentId}`;
  const url = `${path}?${params.toString()}`;
  const response = await outlinerFetch(url);
  const doc = await handleApiResponse(response);
  return withResolvedSegmentTexts(doc);
};

export const getOutlinerDocumentAiTocEntries = async (
  documentId: string
): Promise<OutlinerDocumentAiTocEntries> => {
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/documents/${documentId}/ai-toc-entries`
  );
  return handleApiResponse(response);
};

export const listOutlinerDocuments = async (
  user_id?: string,
  skip: number = 0,
  limit: number = 100,
  include_deleted: boolean = false,
  title?: string,
  include_approved: boolean = false,
  include_skipped: boolean = false
): Promise<OutlinerDocumentListItem[]> => {
  const params = new URLSearchParams();
  if (user_id) params.append('user_id', user_id);
  params.append('skip', skip.toString());
  params.append('limit', limit.toString());
  params.append('include_deleted', include_deleted.toString());
  params.append('include_approved', include_approved.toString());
  params.append('include_skipped', include_skipped.toString());
  if (title?.trim()) params.append('title', title.trim());

  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents?${params.toString()}`);
  return handleApiResponse(response);
};

/** GET …/documents/random-reviewed-ids — up to five random approved documents (id + filename). */
export interface RandomReviewedDocumentSummary {
  id: string;
  filename: string | null;
}

export interface RandomReviewedDocumentIdsResponse {
  documents: RandomReviewedDocumentSummary[];
}

export const getRandomReviewedDocumentIds = async (): Promise<RandomReviewedDocumentIdsResponse> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/random-reviewed-ids`);
  return handleApiResponse(response);
};

/** Approved segments where the current user is ``reviewed_by_id``, grouped by document (paginated). */
export const getMyReviewedSegments = async (
  page: number = 1,
  pageSize: number = 30,
): Promise<MyReviewedSegmentsResponse> => {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/documents/my-reviewed-segments?${params.toString()}`,
  );
  return handleApiResponse(response);
};

export const updateOutlinerDocumentContent = async (
  documentId: string,
  content: string
): Promise<{ message: string; document_id: string }> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/content`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(content),
  });

  return handleApiResponse(response);
};

export const deleteOutlinerDocument = async (documentId: string): Promise<void> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    await handleApiResponse(response);
  }
};

export const getDocumentProgress = async (
  documentId: string
): Promise<DocumentProgress> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/progress`);
  return handleApiResponse(response);
};

// ==================== Segment Endpoints ====================

export const createSegment = async (
  documentId: string,
  segment: SegmentCreateRequest
): Promise<OutlinerSegment> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/segments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(segment),
  });

  return handleApiResponse(response);
};

export const createSegmentsBulk = async (
  documentId: string,
  segments: SegmentCreateRequest[]
): Promise<OutlinerSegment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/segments/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(segments),
  });

  return handleApiResponse(response);
};

export const getSegments = async (documentId: string): Promise<OutlinerSegment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/segments`);
  return handleApiResponse(response);
};

export const getSegment = async (segmentId: string): Promise<OutlinerSegment> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}`);
  return handleApiResponse(response);
};

export const updateSegment = async (
  segmentId: string,
  updates: SegmentUpdateRequest
): Promise<{ message: string; id: string }> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  return handleApiResponse(response);
};

export const updateSegmentsBulk = async (
  updates: BulkSegmentUpdateRequest
): Promise<OutlinerSegment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/bulk`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  return handleApiResponse(response);
};

export const splitSegment = async (
  segmentId: string,
  splitPosition: number,
  documentId?: string
): Promise<OutlinerSegment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/split`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      segment_id: segmentId,
      split_position: splitPosition,
      document_id: documentId,
    }),
  });

  return handleApiResponse(response);
};

export const mergeSegments = async (
  segmentIds: string[]
): Promise<OutlinerSegment> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/merge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ segment_ids: segmentIds }),
  });

  return handleApiResponse(response);
};

export const deleteSegment = async (segmentId: string): Promise<void> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    await handleApiResponse(response);
  }
};

// ==================== Comment Endpoints ====================

export interface CommentCreateRequest {
  content: string;
  username: string;
}

export interface CommentUpdateRequest {
  content: string;
}

export const getSegmentComments = async (segmentId: string): Promise<Comment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/comment`);
  return handleApiResponse(response);
};

export const addSegmentComment = async (
  segmentId: string,
  comment: CommentCreateRequest
): Promise<Comment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(comment),
  });

  return handleApiResponse(response);
};

export const updateSegmentComment = async (
  segmentId: string,
  commentIndex: number,
  comment: CommentUpdateRequest
): Promise<Comment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/comment/${commentIndex}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(comment),
  });

  return handleApiResponse(response);
};

export const deleteSegmentComment = async (
  segmentId: string,
  commentIndex: number
): Promise<Comment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/comment/${commentIndex}`, {
    method: 'DELETE',
  });

  return handleApiResponse(response);
};

/** Next volume from the caller's group's batch. `groupId` is needed only for users in several groups. */
export const assignVolume = async (groupId?: string): Promise<OutlinerDocument> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/assign_volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_id: groupId ?? null }),
  });

  return handleApiResponse(response);
};

/** Server-side rule: every non-deleted owned document is skipped, or all its segments are checked or approved. */
export const getAssignVolumeEligibility = async (): Promise<{ allowed: boolean }> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/assign_volume/eligibility`);
  return handleApiResponse(response);
};


export const updateDocumentStatus = async (
  documentId: string,
  status: string
): Promise<{ message: string; document_id: string; status: string }> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });

  return handleApiResponse(response);
};

export const assignDocumentReviewer = async (
  documentId: string
): Promise<{ message: string; document_id: string; reviewer_id: string }> => {
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/documents/${documentId}/assign-reviewer`,
    { method: 'POST' }
  );
  return handleApiResponse(response);
};

export const updateDocumentAssignee = async (
  documentId: string,
  userId: string
): Promise<{ message: string; document_id: string; user_id: string }> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/assignee`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId }),
  });

  return handleApiResponse(response);
};

/** Reviewer: approve document (all segments must be approved). */
export const approveOutlinerDocument = async (
  documentId: string
): Promise<unknown> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleApiResponse(response);
};

export interface SanityCheckFinding {
  error_type: string;
  char_span: { start: number; end: number };
  confidence: number;
  evidence: string;
  rule_ids: string[];
  severity: 'blocker' | 'advisory';
  segment_id: string;
}

export interface SanityCheckReport {
  volume_id?: string | null;
  flagged_count: number;
  blocker_count: number;
  advisory_count: number;
  findings: SanityCheckFinding[];
}

export interface SubmitToBdrcResult {
  success: boolean;
  requires_confirmation?: boolean;
  sanity_report?: SanityCheckReport;
}

export interface SanityCheckSegmentInput {
  id: string;
  start: number;
  end: number;
  label?: string | null;
}

/**
 * Run the segmentation sanity check against segment spans supplied by the caller, without
 * submitting anything. `segments` should be the spans/labels currently shown in the editor
 * (not re-read from the DB), so the check reflects exactly what the annotator sees. Used to
 * show all flagged issues up front, before the annotator decides whether to fix segments or
 * submit anyway.
 */
export const checkDocumentSanity = async (
  documentId: string,
  segments: SanityCheckSegmentInput[],
  signal?: AbortSignal
): Promise<SanityCheckReport> => {
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/documents/${documentId}/sanity-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments }),
      signal,
    }
  );
  return handleApiResponse(response);
};

/**
 * Push outline to BDRC OTAPI with status in_review and set document status to completed
 * (single round-trip). `isComplete` is false when the scanned volume is missing pages at
 * the beginning and/or the end; it is pushed to BDRC as the volume-level `complete` flag.
 *
 * The submission first runs through a segmentation sanity check. If it flags anything and
 * `ignoreSanityWarnings` isn't set, the backend holds the submission and returns
 * `{ success: false, sanity_report }` instead of submitting, so the caller can show the
 * warnings and let the annotator resubmit with `ignoreSanityWarnings: true` to proceed anyway.
 */
export const submitDocumentToBdrcInReview = async (
  documentId: string,
  isComplete: boolean = true,
  ignoreSanityWarnings: boolean = false
): Promise<SubmitToBdrcResult> => {
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/documents/${documentId}/submit-bdrc-in-review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_complete: isComplete,
        ignore_sanity_warnings: ignoreSanityWarnings,
      }),
    }
  );
  return handleApiResponse(response);
};

export type SegmentReviewStatus = 'approve' | 'reject';

export interface SegmentReview {
  id: string;
  document_id: string;
  segment_id: string;
  user_id: string;
  status: SegmentReviewStatus;
  comment?: string | null;
  created_at: string;
  updated_at: string;
}

export const submitSegmentReview = async (
  segmentId: string,
  status: SegmentReviewStatus,
  comment?: string
): Promise<SegmentReview> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, comment }),
  });
  return handleApiResponse(response);
};

export interface SegmentReviewStatusItem {
  segment_id: string;
  status: SegmentReviewStatus;
}

export interface SegmentReviewsResponse {
  document_id: string;
  items: SegmentReviewStatusItem[];
}

export const getSegmentReviews = async (
  documentId: string
): Promise<Record<string, SegmentReviewStatus>> => {
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/documents/${documentId}/segment-reviews`
  );
  const data: SegmentReviewsResponse = await handleApiResponse(response);
  return Object.fromEntries(data.items.map((item) => [item.segment_id, item.status]));
};

export const rejectSegment = async (
  segmentId: string,
  comment: string,
  markedSpans?: MarkedSpan[]
): Promise<OutlinerSegment> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/reject`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comment,
      ...(markedSpans?.length ? { marked_spans: markedSpans } : {}),
    }),
  });
  return handleApiResponse(response);
};

export const getSegmentRejectionHistory = async (
  segmentId: string
): Promise<SegmentRejectionHistoryResponse> => {
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/segments/${segmentId}/rejections`
  );
  return handleApiResponse(response);
};

export const rejectSegmentsBulk = async (
  segmentIds: string[],
  comment: string
): Promise<OutlinerSegment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/bulk-reject`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment_ids: segmentIds, comment }),
  });
  return handleApiResponse(response);
};

export const updateSegmentStatus = async (
  segmentId: string,
  status: 'checked' | 'unchecked' | 'approved' | 'rejected'
): Promise<{ message: string; segment_id: string; status: string }> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/segments/${segmentId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });

  return handleApiResponse(response);
};

export const bulkSegmentOperations = async (
  documentId: string,
  operations: BulkSegmentOperationsRequest
): Promise<OutlinerSegment[]> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/segments/bulk-operations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(operations),
  });

  return handleApiResponse(response);
};

export const resetSegments = async (documentId: string): Promise<void> => {
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/documents/${documentId}/segments/reset`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    await handleApiResponse(response);
  }
};

// ==================== Dashboard Stats ====================

export interface AnnotatorPerformanceRow {
  user_id: string | null;
  document_count: number;
  segment_count: number;
  segments_with_title_or_author: number;
  /** Unresolved rejected segments on that annotator's documents in range (latest rejection not resolved) */
  rejection_count: number;
  /** All segment_rejection rows attributed to that annotator (same document date scope as segment_count) */
  rejection_event_count?: number;
  /** 100 * rejection_event_count / segment_count when segment_count > 0 */
  rejection_events_pct_of_segments?: number | null;
  /** Segments in checked/approved state with this user as recorded reviewer */
  segments_reviewed?: number;
  /** Same as segments_reviewed but document owner is also this user (self-check) */
  segments_self_reviewed?: number;
  /** Count of rejection rows where this user is reviewer_id */
  reviewer_rejection_count?: number;
  /** Approved segments on this user's documents where reviewer set title or author at approval */
  segments_reviewer_corrected_title_or_author?: number;
  /** Segments with status approved on this user's documents (dashboard date scope) */
  segments_approved?: number;
}

/** Per volume batch from BEC OT API ``/stats/volume-batches`` (batch id is the object key). */
export interface VolumeBatchStatusCounts {
  in_review: number;
  reviewed: number;
  in_progress: number;
  active: number;
  skipped: number;
}

/** Per reviewer/admin user; same document + date scope as dashboard stats (including optional annotator filter). */
export interface ReviewerSegmentActivityRow {
  user_id: string;
  /** Checked/approved segments where this user is recorded as ``reviewed_by_id``. */
  segments_recorded_as_reviewer: number;
  /** Same scope: reviewed segments where annotator title and/or author is set. */
  reviewed_segments_with_title_or_author: number;
  /** Approved segments where trimmed reviewer title/author differs from title/author (same ``reviewed_by_id``). */
  reviewer_title_author_edits: number;
  /** Rows in segment_rejections with this user as reviewer_id (same document date scope as dashboard). */
  reviewer_rejection_count: number;
}

export interface DashboardChartSeries {
  labels: string[];
  values: number[];
  keys?: string[];
}

export interface DashboardOverviewBar {
  labels: string[];
  values: number[];
}

export interface DashboardLabeledCount {
  key: string;
  label: string;
  count: number;
}

export interface DashboardDocumentStatusBreakdown {
  approved: number;
  completed: number;
  active: number;
  skipped: number;
}

export interface AnnotatorQualityTableRow {
  user_id: string | null;
  name: string;
  segments: number;
  segments_approved: number;
  rejection_events: number;
  rejection_pct: number;
  correction_edits: number;
  corrections_pct: number;
}

export interface AnnotatorQualityChartMeta {
  events?: number;
  approved?: number;
  edits?: number;
}

export interface AnnotatorQualityChart {
  labels: string[];
  rejection_pct: number[];
  rejection_meta: AnnotatorQualityChartMeta[];
  edits_pct: number[];
  edits_meta: AnnotatorQualityChartMeta[];
  segment_counts: number[];
  approved_counts: number[];
}

/**
 * Per-annotator quality from `annotator_performance` (all segments on in-range documents).
 * Rejection/correction % denominators use `segments_approved` (status approved), not
 * `segments_with_title_or_author` or `reviewed_segments`.
 */
export interface AnnotatorQualityView {
  chart: AnnotatorQualityChart;
  table_rows: AnnotatorQualityTableRow[];
}

export interface AnnotatorWorkloadSeries {
  label: string;
  values: number[];
}

export interface AnnotatorWorkloadView {
  labels: string[];
  series: AnnotatorWorkloadSeries[];
}

export interface ReviewerActivityTableRow {
  user_id: string | null;
  name: string;
  segments_reviewed: number;
  with_title_author: number;
  title_author_edits: number;
  rejections: number;
  reviewed_share_pct: number;
  with_title_author_rate_pct: number;
  edits_rate_pct: number;
  rejections_rate_pct: number;
  reviewed_bar_pct: number;
  with_title_author_bar_pct: number;
  edits_bar_pct: number;
  rejections_bar_pct: number;
}

export interface ReviewerActivityChart {
  labels: string[];
  segments_reviewed: number[];
  with_title_author: number[];
  title_author_edits: number[];
  rejections: number[];
}

export interface ReviewerActivityView {
  has_activity: boolean;
  chart: ReviewerActivityChart | null;
  table_rows: ReviewerActivityTableRow[];
}

export interface VolumeBatchTableRow {
  batch_id: string;
  in_review: number;
  reviewed: number;
  in_progress: number;
  active: number;
  skipped: number;
}

export interface VolumeBatchView {
  state: 'unavailable' | 'empty' | 'rows';
  rows: VolumeBatchTableRow[];
  total_active: number;
  show_low_batch_warning: boolean;
}

export interface DashboardPresentation {
  overview_bar: DashboardOverviewBar;
  document_status_chart: DashboardChartSeries | null;
  segment_status_chart: DashboardChartSeries | null;
  segment_status_footer: DashboardLabeledCount[];
  segment_label_chart: DashboardChartSeries | null;
  document_status_breakdown: DashboardDocumentStatusBreakdown;
  annotator_quality: AnnotatorQualityView | null;
  annotator_workload: AnnotatorWorkloadView | null;
  reviewer_activity: ReviewerActivityView;
  volume_batches: VolumeBatchView;
}

export interface DashboardStats {
  document_count: number;
  total_segments: number;
  segments_with_title_or_author: number;
  /** Subset with title/author where segment status is approved */
  reviewed_segments: number;
  /** Subset with title/author where segment status is checked */
  annotated_segments: number;
  /** Subset with title/author where segment status is rejected */
  rejected_segments_with_title_or_author: number;
  /** Subset with title/author where segment status is unchecked or null */
  unchecked_segments_with_title_or_author: number;
  annotating_segments: number;
  /** Segments that are not checked/approved (e.g. unchecked or rejected) */
  /** Unresolved rejected segments: status rejected and latest rejection row is not resolved */
  rejection_count: number;
  /** Checked/approved segments that record who reviewed (reviewed_by_id set) */
  document_status_counts: Record<string, number>;
  document_category_counts: Record<string, number>;
  segment_status_counts: Record<string, number>;
  segment_label_counts: Record<string, number>;
  segments_with_bdrc_id: number;
  segments_with_parent: number;
  /** Segments with status rejected that have stored comments */
  segments_with_comments: number;
  /** Approved segments where the reviewer changed title or author after annotator check */
  segments_reviewer_corrected_title_or_author: number;
  /**
   * Present (number, possibly 0) only when user_id filter is set and that user is reviewer or
   * admin: checked/approved segments where this user is recorded as reviewer (`reviewed_by_id`),
   * across all annotators' documents in the date range. Omitted or null otherwise.
   */
  annotation_coverage_pct: number;
  /** Per-annotator breakdown (same date range as dashboard; not scoped by user filter). */
  annotator_performance?: AnnotatorPerformanceRow[];
  /** Reviewer/admin roster; document + date + optional user filter, same as other dashboard metrics. */
  reviewer_segment_activity?: ReviewerSegmentActivityRow[];
  /**
   * Per batch ID from BEC OT API; not scoped by dashboard date or annotator filters.
   * Null when the cataloger server could not reach the upstream API.
   */
  volume_batch_stats?: Record<string, VolumeBatchStatusCounts> | null;
  presentation: DashboardPresentation;
}

export const getDashboardStats = async (
  user_id?: string,
  start_date?: string,
  end_date?: string,
): Promise<DashboardStats> => {
  const params = new URLSearchParams();
  if (user_id) params.append('user_id', user_id);
  if (start_date) params.append('start_date', start_date);
  if (end_date) params.append('end_date', end_date);
  const qs = params.toString();
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/dashboard/stats${qs ? `?${qs}` : ''}`);
  return handleApiResponse(response);
};

/** One document behind the "Annotated (pending review)" dashboard stat. */
export interface AnnotatedPendingReviewDocumentRow {
  document_id: string;
  filename: string;
  annotator_user_id: string | null;
  annotator_name: string;
  /** Segments on this document with title/author set and status 'checked'. */
  segment_count: number;
  updated_at: string;
}

export interface AnnotatedPendingReviewDocumentsResponse {
  rows: AnnotatedPendingReviewDocumentRow[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

/** GET …/dashboard/annotated-pending-review-documents — drill-down for the pipeline overview stat, paginated. */
export const getAnnotatedPendingReviewDocuments = async (
  page: number = 1,
  pageSize: number = 30,
  user_id?: string,
  start_date?: string,
  end_date?: string,
): Promise<AnnotatedPendingReviewDocumentsResponse> => {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (user_id) params.append('user_id', user_id);
  if (start_date) params.append('start_date', start_date);
  if (end_date) params.append('end_date', end_date);
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/dashboard/annotated-pending-review-documents?${params.toString()}`,
  );
  return handleApiResponse(response);
};

export type AnnotatorWeeklyBucketBy = 'reviewed' | 'annotated';

export interface AnnotatorWeeklyQualityRow {
  user_id: string | null;
  name: string;
  /** ISO date of the Monday starting the week. */
  week: string | null;
  /** Segments reviewed this week — the denominator for every rate below. */
  approved: number;
  edited: number;
  rejected: number;
  /** Reviewed with no correction and no rejection; clean + edited + rejected === approved. */
  clean: number;
  edits_pct: number;
  rejection_pct: number;
  clean_pct: number;
}

export interface AnnotatorWeeklyQualityResponse {
  bucket_by: AnnotatorWeeklyBucketBy;
  rows: AnnotatorWeeklyQualityRow[];
}

export const getAnnotatorWeeklyQuality = async (
  bucket_by: AnnotatorWeeklyBucketBy = 'reviewed',
  user_id?: string,
  start_date?: string,
  end_date?: string,
): Promise<AnnotatorWeeklyQualityResponse> => {
  const params = new URLSearchParams();
  params.append('bucket_by', bucket_by);
  if (user_id) params.append('user_id', user_id);
  if (start_date) params.append('start_date', start_date);
  if (end_date) params.append('end_date', end_date);
  const response = await outlinerFetch(
    `${OUTLINER_BASE_URL}/dashboard/annotator-weekly-quality?${params.toString()}`,
  );
  return handleApiResponse(response);
};

// ==================== Statistics ====================

export interface AnnotatorApprovedRow {
  user_id: string | null;
  name: string;
  segments_approved: number;
  edited_segments: number;
  rejection_count: number;
  rejected_segments: number;
}

export interface ReviewerApprovedRow {
  user_id: string | null;
  name: string;
  segments_reviewed: number;
  edited_segments: number;
  rejection_count: number;
  /** Approved segments the reviewer added themselves during review (not in segments_reviewed). */
  segments_annotated: number;
}

export interface StatisticsData {
  annotators: AnnotatorApprovedRow[];
  reviewers: ReviewerApprovedRow[];
  /** The filtered user's own review output. Empty without a user filter. */
  reviewed_by_user?: ReviewerApprovedRow[];
}

export const getStatistics = async (
  user_id?: string,
  start_date?: string,
  end_date?: string,
): Promise<StatisticsData> => {
  const params = new URLSearchParams();
  if (user_id) params.append('user_id', user_id);
  if (start_date) params.append('start_date', start_date);
  if (end_date) params.append('end_date', end_date);
  const qs = params.toString();
  const url = qs ? `${OUTLINER_BASE_URL}/dashboard/statistics?${qs}` : `${OUTLINER_BASE_URL}/dashboard/statistics`;
  const response = await outlinerFetch(url);
  return handleApiResponse(response);
};

// ==================== Work Groups ====================
// A group links annotators and reviewers to one BDRC volume batch.

export interface OutlinerGroupMember {
  user_id: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  role: string | null;
}

export interface OutlinerGroup {
  id: string;
  name: string;
  batch_id: string | null;
  members: OutlinerGroupMember[];
}

export type MyOutlinerGroup = Omit<OutlinerGroup, 'members'>;

export interface BatchOption {
  batch_id: string;
  active: number;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', accept: 'application/json' };

export const getMyGroups = async (): Promise<MyOutlinerGroup[]> =>
  handleApiResponse(await outlinerFetch(`${OUTLINER_BASE_URL}/groups/mine`));

export const listGroups = async (): Promise<OutlinerGroup[]> =>
  handleApiResponse(await outlinerFetch(`${OUTLINER_BASE_URL}/groups`));

export const listGroupBatches = async (): Promise<BatchOption[]> =>
  handleApiResponse(await outlinerFetch(`${OUTLINER_BASE_URL}/groups/batches`));

export const createGroup = async (body: { name: string; batch_id: string | null }): Promise<OutlinerGroup> =>
  handleApiResponse(
    await outlinerFetch(`${OUTLINER_BASE_URL}/groups`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
  );

export const updateGroup = async (
  groupId: string,
  body: { name?: string; batch_id?: string | null }
): Promise<OutlinerGroup> =>
  handleApiResponse(
    await outlinerFetch(`${OUTLINER_BASE_URL}/groups/${groupId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
  );

export const setGroupMembers = async (groupId: string, userIds: string[]): Promise<OutlinerGroup> =>
  handleApiResponse(
    await outlinerFetch(`${OUTLINER_BASE_URL}/groups/${groupId}/members`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ user_ids: userIds }),
    })
  );

export const deleteGroup = async (groupId: string): Promise<void> =>
  handleApiResponse(
    await outlinerFetch(`${OUTLINER_BASE_URL}/groups/${groupId}`, { method: 'DELETE' })
  );

// ==================== Reviewer Stats ====================

export interface ReviewVerifierBreakdownRow {
  user_id: string;
  reviewer: string;
  total_segments: number;
  approvals: number;
  rejections: number;
}

export interface ReviewerStatsBreakdownRow {
  user_id: string;
  reviewer: string;
  approvals: number;
  rejections: number;
}

export interface ReviewerStatsData {
  review_verifier_breakdown: ReviewVerifierBreakdownRow[];
  reviewer_breakdown: ReviewerStatsBreakdownRow[];
}

export const getReviewerStats = async (
  user_id?: string,
  start_date?: string,
  end_date?: string,
): Promise<ReviewerStatsData> => {
  const params = new URLSearchParams();
  if (user_id) params.append('user_id', user_id);
  if (start_date) params.append('start_date', start_date);
  if (end_date) params.append('end_date', end_date);
  const qs = params.toString();
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/dashboard/reviewer-stats${qs ? `?${qs}` : ''}`);
  return handleApiResponse(response);
};

// ==================== AI Endpoints ====================

/** Boundary detector for POST /outliner/ai-outline. */
export type OutlineDetector = 'rule' | 'mmbert';

/** Result of POST /outliner/ai-outline — segments are refetched via the document query. */
export interface AiOutlineResponse {
  segment_count: number;
}

/**
 * Run AI outline detection on the full document and replace segments with splits at detected indices.
 */
export const runAiOutline = async (
  documentId: string,
  options?: { detector?: OutlineDetector; signal?: AbortSignal }
): Promise<AiOutlineResponse> => {
  const params = new URLSearchParams({ document_id: documentId });
  if (options?.detector) params.set('detector', options.detector);
  const response = await outlinerFetch(`${OUTLINER_BASE_URL}/ai-outline?${params.toString()}`, {
    method: 'POST',
    headers: { accept: 'application/json' },
    signal: options?.signal,
  });

  return handleApiResponse(response);
};

export interface GenerateTitleAuthorRequest {
  content: string;
}

export interface GenerateTitleAuthorResponse {
  title?: string;
  suggested_title?: string;
  author?: string;
  suggested_author?: string;
}

export const generateTitleAuthor = async (
  request: GenerateTitleAuthorRequest,
  signal?: AbortSignal
): Promise<GenerateTitleAuthorResponse> => {
  const response = await outlinerFetch(`${API_URL}/ai/generate-title-author`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  return handleApiResponse(response);
};

export interface ParseTocRequest {
  content: string;
  /** When set, backend persists entries on this outliner document (or clears if not a TOC) */
  document_id?: string;
}

export interface ParseTocResponse {
  is_toc: boolean;
  entries: string[];
}


// ==================== Utility Functions ====================

/**
 * Convert OutlinerSegment to TextSegment format used in frontend
 */
export const outlinerSegmentToTextSegment = (
  segment: OutlinerSegment,
  documentContent: string
): TextSegment => {
  const text =
    segment.text ??
    segmentBodyFromDocument(documentContent, segment.span_start, segment.span_end);
  return {
    id: segment.id,
    text,
    span_start: segment.span_start,
    span_end: segment.span_end,
    title: segment.title || undefined,
    author: segment.author || undefined,
    title_span_start: segment.title_span_start ?? undefined,
    title_span_end: segment.title_span_end ?? undefined,
    updated_title: segment.updated_title ?? undefined,
    author_span_start: segment.author_span_start ?? undefined,
    author_span_end: segment.author_span_end ?? undefined,
    updated_author: segment.updated_author ?? undefined,
    title_bdrc_id: segment.title_bdrc_id || undefined,
    author_bdrc_id: segment.author_bdrc_id || undefined,
    parentSegmentId: segment.parent_segment_id || undefined,
    is_attached: segment.is_attached ?? undefined,
    status: segment.status || undefined,
    label: segment.label ?? undefined,
    rejection: segment.rejection ?? undefined,
    is_supplied_title: segment.is_supplied_title ?? undefined,
    reviewer_title: segment.reviewer_title ?? undefined,
    reviewer_author: segment.reviewer_author ?? undefined,
    comments: segment.comments,
    created_by_id: segment.created_by_id ?? undefined,
    corrected_by_reviewer: segment.corrected_by_reviewer ?? undefined,
  };
};

/**
 * Convert TextSegment to OutlinerSegment format for API
 * Note: text is not included - backend will extract it from document using span addresses
 */
export const textSegmentToOutlinerSegment = (
  segment: TextSegment,
  _documentId: string,
  index: number,
  spanStart: number,
  spanEnd: number
): SegmentCreateRequest => {
  return {
    // text is omitted - backend extracts from document content using span_start/span_end
    segment_index: index,
    span_start: spanStart,
    span_end: spanEnd,
    title: segment.title,
    author: segment.author,
    title_bdrc_id: segment.title_bdrc_id,
    author_bdrc_id: segment.author_bdrc_id,
    parent_segment_id: segment.parentSegmentId,
  };
};
