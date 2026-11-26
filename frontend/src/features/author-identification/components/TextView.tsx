import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cleanName, hasTibetan } from '../utils';

// Longer than any name: a selection past this is someone reading, not picking a name.
const MAX_SELECTION = 80;

/** The text, with the model's evidence marked. Selecting a name in it offers to search it. */
export default function TextView({
  content,
  evidence,
  focusEvidence,
  onSearchName,
}: Readonly<{
  content: string;
  evidence: string | null;
  /** Goes up by one each time the evidence should be scrolled to. */
  focusEvidence: number;
  onSearchName: (name: string) => void;
}>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState('');

  useEffect(() => {
    if (focusEvidence > 0) markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusEvidence]);

  useEffect(() => {
    const onSelect = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setPicked('');
        return;
      }
      const inText =
        textRef.current?.contains(selection.anchorNode) && textRef.current.contains(selection.focusNode);
      const name = inText ? cleanName(selection.toString()) : '';
      setPicked(name.length <= MAX_SELECTION && hasTibetan(name) ? name : '');
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, []);

  const at = evidence ? content.indexOf(evidence) : -1;
  const toEnd = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 text-sm text-gray-500">
        {picked ? (
          <Button
            size="sm"
            // Keep the selection when pressed, so the name is still there to search.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSearchName(picked)}
            className="h-7 min-w-0 cursor-pointer bg-blue-600 text-white hover:bg-blue-700"
          >
            <Search /> Search <span className="truncate font-monlam">{picked}</span>
          </Button>
        ) : (
          <span>Select a name in the text to search for it</span>
        )}
        <button
          type="button"
          onClick={toEnd}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 font-medium text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" /> Go to end
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div ref={textRef} lang="bo" className="mx-auto max-w-3xl whitespace-pre-wrap break-words font-monlam text-base leading-[2.1] text-gray-900 xl:text-lg xl:leading-[2.2]">
          {at < 0 || !evidence ? (
            content
          ) : (
            <>
              {content.slice(0, at)}
              <mark ref={markRef} className="rounded bg-amber-200 px-0.5 text-gray-900">
                {evidence}
              </mark>
              {content.slice(at + evidence.length)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
