import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import i18n from '@/i18n/config';
import { generateTitleAuthor, type GenerateTitleAuthorResponse } from '@/api/outliner';
import { toast } from 'sonner';
import type { AISuggestions, TextSegment } from '@/features/outliner/types';

interface UseAISuggestionsOptions {
  activeSegment: TextSegment | undefined;
  activeSegmentId: string | null;
}

/**
 * The segment as the AI saw it: a split keeps the upper segment's id but changes its text,
 * so that counts as a new segment (one fresh automatic run, no stale answer).
 */
const segmentKey = (segmentId: string | null, segment: TextSegment | undefined) =>
  segmentId ? `${segmentId}:${segment?.text?.trim().length ?? 0}` : null;

/**
 * Hook to manage AI suggestions for title and author detection using React Query.
 *
 * Answers are remembered per segment for this page visit: reopening a segment shows the same
 * suggestions (or "no author found") without asking the AI again. The automatic run asks at
 * most once per segment; the AI button always asks again.
 */
export const useAISuggestions = ({ activeSegment, activeSegmentId }: UseAISuggestionsOptions) => {
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestions | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const answersRef = useRef(new Map<string, AISuggestions>());
  const autoAskedRef = useRef(new Set<string>());
  const key = segmentKey(activeSegmentId, activeSegment);
  const keyRef = useRef(key);
  keyRef.current = key;

  type AIMutationVars = { content: string; key: string; signal?: AbortSignal };

  // Mutation for AI title/author generation
  const mutation = useMutation({
    mutationFn: ({ content, signal }: AIMutationVars) =>
      generateTitleAuthor({ content }, signal),
    onSuccess: (data: GenerateTitleAuthorResponse, { key: askedFor }) => {
      answersRef.current.set(askedFor, data as AISuggestions);
      // The reviewer may have moved on to another segment while the AI was answering.
      if (askedFor === keyRef.current) setAiSuggestions(data as AISuggestions);
    },
    onError: (error: Error) => {
      if (error.name !== 'AbortError') {
        toast.error(i18n.t('outliner.aiSuggestions.failed', { message: error.message }));
      }
    },
  });

  // Another segment: stop any request and show what the AI already said about it, if anything.
  useEffect(() => {
    if (aiAbortControllerRef.current) {
      aiAbortControllerRef.current.abort();
      aiAbortControllerRef.current = null;
    }
    mutation.reset();
    setAiSuggestions(key ? answersRef.current.get(key) ?? null : null);
  }, [key]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (aiAbortControllerRef.current) {
        aiAbortControllerRef.current.abort();
      }
    };
  }, []);

  const ask = useCallback(
    async (automatic: boolean) => {
      if (!activeSegmentId || !activeSegment?.text || !key) return;
      if (activeSegment.status === 'checked') return;
      if (activeSegment.label !== 'TEXT') return;

      const text = activeSegment.text.trim();
      if (!text) return;

      if (automatic) {
        // Once per segment: later visits show the remembered answer instead.
        if (autoAskedRef.current.has(key)) return;
        autoAskedRef.current.add(key);
      }

      // Abort any existing request
      if (aiAbortControllerRef.current) {
        aiAbortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const abortController = new AbortController();
      aiAbortControllerRef.current = abortController;

      try {
        await mutation.mutateAsync({
          content: text,
          key,
          signal: abortController.signal,
        });
      } catch {
        // Error handling is done in mutation onError.
        // An automatic run that never got its answer may try again on the next visit.
        if (automatic && !answersRef.current.has(key)) autoAskedRef.current.delete(key);
      } finally {
        if (!abortController.signal.aborted) {
          aiAbortControllerRef.current = null;
        }
      }
    },
    [activeSegmentId, activeSegment, key, mutation]
  );

  const handleAIDetect = useCallback(() => ask(false), [ask]);
  const handleAIAutoDetect = useCallback(() => ask(true), [ask]);

  const handleAIStop = useCallback(() => {
    if (aiAbortControllerRef.current) {
      aiAbortControllerRef.current.abort();
      aiAbortControllerRef.current = null;
    }
    mutation.reset();
    setAiSuggestions(null);
  }, [mutation, activeSegmentId]);

  return useMemo(
    () => ({
      aiSuggestions,
      aiLoading: mutation.isPending,
      onAIDetect: handleAIDetect,
      onAIAutoDetect: handleAIAutoDetect,
      onAIStop: handleAIStop,
    }),
    [aiSuggestions, mutation.isPending, handleAIDetect, handleAIAutoDetect, handleAIStop]
  );
};
