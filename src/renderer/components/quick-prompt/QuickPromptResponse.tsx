import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, Brain } from 'lucide-react';

type PromptPhase = 'idle' | 'streaming' | 'complete' | 'error';

interface QuickPromptResponseProps {
  content: string;
  thinkingContent: string;
  authorName: string;
  phase: PromptPhase;
  error?: string;
}

export function QuickPromptResponse({
  content,
  thinkingContent,
  phase,
  error,
}: QuickPromptResponseProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (phase === 'streaming' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, thinkingContent, phase]);

  return (
    <div
      ref={scrollRef}
      className="qp-response-enter max-h-[min(55vh,520px)] overflow-y-auto border-t border-[var(--color-border-subtle)]"
    >
      {/* Error state */}
      {phase === 'error' && error && (
        <div className="flex items-start gap-3 px-5 py-4">
          <AlertCircle className="mt-0.5 size-4 flex-none text-[var(--color-status-error)]" />
          <p className="text-[13px] leading-relaxed text-[var(--color-status-error)]">{error}</p>
        </div>
      )}

      {/* Thinking block — collapsed visualization */}
      {thinkingContent && (
        <div className="mx-5 mt-4 mb-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/50 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--color-text-muted)]">
            <Brain className="size-3.5" />
            <span>Thinking</span>
            {phase === 'streaming' && !content && (
              <span className="flex gap-0.5 ml-1">
                <span className="thinking-dot inline-block size-1 rounded-full bg-[var(--color-text-muted)]" />
                <span className="thinking-dot inline-block size-1 rounded-full bg-[var(--color-text-muted)]" />
                <span className="thinking-dot inline-block size-1 rounded-full bg-[var(--color-text-muted)]" />
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-text-muted)] line-clamp-3">
            {thinkingContent.slice(-300)}
          </p>
        </div>
      )}

      {/* Main response content */}
      {content && (
        <div className="px-5 py-4">
          <div className="markdown-content text-[13.5px] text-[var(--color-text-primary)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Streaming indicator when no content yet */}
      {phase === 'streaming' && !content && !thinkingContent && (
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex gap-1">
            <span className="thinking-dot inline-block size-1.5 rounded-full bg-[var(--color-accent)]" />
            <span className="thinking-dot inline-block size-1.5 rounded-full bg-[var(--color-accent)]" />
            <span className="thinking-dot inline-block size-1.5 rounded-full bg-[var(--color-accent)]" />
          </span>
          <span className="text-[12px] text-[var(--color-text-muted)]">Generating response…</span>
        </div>
      )}
    </div>
  );
}
