import React, { createContext, useContext } from 'react'
import type { TextSegment } from '../types'
import type { SanityCheckFinding, SanityCheckReport } from '@/api/outliner'

interface DocumentContextValue {
  textContent: string
  segments: TextSegment[]
  checkedSegmentsCount: number
  checked_percentage: number
  rejectedSegmentsCount: number
  segmentsCount: number
  activeSegmentId: string | null
  /** Current Title field value in the sidebar for the active segment (may differ from saved segment.title until Save). */
  sidebarTitleDraft: string
  /** In-segment text search query for the active segment (sidebar Metadata tab + workspace highlights). */
  activeSegmentSearchQuery: string
  setActiveSegmentSearchQuery: (query: string) => void
  aiTextEndingLoading: boolean
  segmentLoadingStates: Map<string, boolean>
  isUploading?: boolean
  /** Result of the last on-demand sanity check (null until one has been run). */
  sanityReport: SanityCheckReport | null
  /** Sanity-check findings grouped by segment_id, for per-segment alert icons. */
  sanityFindingsBySegmentId: Map<string, SanityCheckFinding[]>
  isCheckingSanity: boolean
  sanityCheckFailed: boolean
  /** Approved document opened by its annotator: shown for reading, nothing can be changed. */
  isReadOnly: boolean
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

export function useDocument() {
  const context = useContext(DocumentContext)
  if (!context) {
    throw new Error('useDocument must be used within DocumentProvider')
  }
  return context
}

/** Like `useDocument`, but returns null outside a provider instead of throwing. */
export function useOptionalDocument() {
  return useContext(DocumentContext)
}

interface DocumentProviderProps {
  children: React.ReactNode
  value: DocumentContextValue
}

export function DocumentProvider({ children, value }: DocumentProviderProps) {
  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>
}
