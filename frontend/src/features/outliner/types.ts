import type { Comment, RejectedSegmentListNotice, SegmentRejection } from '@/api/outliner'

/** Segment label enum: FRONT_MATTER, TOC, TEXT, BACK_MATTER */
export type SegmentLabel = 'FRONT_MATTER' | 'TOC' | 'TEXT' | 'BACK_MATTER'

export interface TextSegment {
  id: string
  text: string
  /** Character range in full document content (for BDRC matching, etc.) */
  span_start?: number
  span_end?: number
  title?: string
  author?: string
  /** Document-level offsets for title selected from source text */
  title_span_start?: number
  title_span_end?: number
  updated_title?: string
  author_span_start?: number
  author_span_end?: number
  updated_author?: string
  /** Reviewer-proposed title; does not replace annotator title until applied in workspace */
  reviewer_title?: string | null
  reviewer_author?: string | null
  title_bdrc_id?: string
  author_bdrc_id?: string
  parentSegmentId?: string
  is_attached?: boolean | null
  status?: string | null
  label?: SegmentLabel | null
  rejection?: SegmentRejection | null
  is_supplied_title?: boolean | null
  comments: Comment[]
  /** Set when the reviewer added this segment during review; unset = the annotator's. */
  created_by_id?: string
  /** The reviewer split/merged this annotator segment. */
  corrected_by_reviewer?: boolean
}

export interface BubbleMenuProps {
  segmentId: string
}

export interface SplitMenuProps {
  segmentId: string
}

export interface SegmentTextContentProps {
  segmentId: string
  text: string
  title?: string
  author?: string
  /** Plain-text query; matches are highlighted in the segment (case-insensitive). */
  segmentSearchQuery?: string
  /** Reviewer-marked wrong text, in body-relative offsets, sorted and non-overlapping. */
  markedSpans?: { start: number; end: number; note?: string | null }[]
  onCursorChange: (segmentId: string, element: HTMLDivElement) => void
  onActivate: () => void
  onInput: (e: React.FormEvent<HTMLDivElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}

export interface BubbleMenuState {
  segmentId: string
  position: { x: number; y: number }
  selectedText: string
  selectionRange?: Range
  /** Start offset within segment plain text (matches cursor/split indexing; for BDRC page sync) */
  selectionStartOffset?: number
}

export interface CursorPosition {
  segmentId: string
  offset: number
  menuPosition?: { x: number; y: number }
}

export interface AISuggestions {
  title: string | null
  suggested_title: string | null
  author: string | null
  suggested_author: string | null
}

// Admin / API types
export interface Document {
  id: string
  content: string
  filename?: string | null
  user_id?: string | null
  reviewer_id?: string | null
  total_segments: number
  annotated_segments: number
  /** Segments with status checked or approved (same as annotator dashboard list). */
  checked_segments?: number
  /** Segments with status rejected (admin list API) */
  rejection_count?: number
  /** Total segment_rejection rows (reviewer comments) on this document (admin list API). */
  rejection_comment_count?: number
  /**
   * Distinct segments with rejection rows whose status is not checked/approved (admin list API).
   * When zero but rejection_comment_count > 0, linked segments are checked or approved.
   */
  rejection_open_segment_count?: number
  /** Reviewer rejection addressed: segment checked, latest rejection resolved (admin list). */
  rejection_resolved?: boolean
  /** List API: present when document is approved/completed and a segment is still rejected */
  rejected_segment?: RejectedSegmentListNotice | null
  progress_percentage: number
  status?: string | null
  /** Times reviewers submitted approved work from admin (POST .../approve) */
  submit_count?: number | null
  created_at: string
  updated_at: string
  /** Present on admin document detail responses */
  segments?: Segment[]
  /** Document detail: segments the reviewer split off in this review round, and the cap. */
  reviewer_splits_used?: number | null
  reviewer_split_limit?: number | null
}

/** User attribution on admin/reviewer segment payloads (same shape as rejection reviewer). */
export interface SegmentAttributionUser {
  user_id: string
  name?: string | null
  picture?: string | null
}

export interface Segment {
  id: string
  text: string
  segment_index: number
  span_start: number
  span_end: number
  title?: string | null
  author?: string | null
  title_span_start?: number | null
  title_span_end?: number | null
  updated_title?: string | null
  author_span_start?: number | null
  author_span_end?: number | null
  updated_author?: string | null
  reviewer_title?: string | null
  reviewer_author?: string | null
  title_bdrc_id?: string | null
  author_bdrc_id?: string | null
  parent_segment_id?: string | null
  is_annotated: boolean
  is_attached?: boolean | null
  status?: string | null
  rejection?: SegmentRejection | null
  comments?: Comment[]
  created_at?: string
  updated_at?: string
  label?: SegmentLabel | null
  is_supplied_title?: boolean | null
  /** Document assignee (who annotates this document). */
  annotator?: SegmentAttributionUser | null
  /** User who last marked this segment checked/approved. */
  reviewed_by?: SegmentAttributionUser | null
  reviewed_at?: string | null
  /** Set when the reviewer added this segment during review; null = the annotator's. */
  created_by_id?: string | null
  /** The reviewer split/merged this annotator segment. */
  corrected_by_reviewer?: boolean | null
}

export interface DocumentStats {
  total: number
  active: number
  completed: number
  approved: number
  rejected: number
}
