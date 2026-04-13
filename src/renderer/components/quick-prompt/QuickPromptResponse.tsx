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
      className="qp-response-enter max-h-[min(50vh,480px)] overflow-y-auto overscroll-contain border-t border-[var(--color-border-subtle)]/60"
    >
      {/* Error state */}
      {phase === 'error' && error && (
        <div className="flex items-start gap-3 px-5 py-4">
          <AlertCircle className="mt-0.5 size-4 flex-none text-[var(--color-status-error)]" />
          <div>
            <p className="text-[12px] font-semibold text-[var(--color-status-error)]">Something went wrong</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-status-error)]/80">{error}</p>
          </div>
        </div>
      )}

      {/* Thinking block — compact collapsed visualization */}
      {thinkingContent && (
        <div className="mx-5 mt-3 mb-1 rounded-lg border border-[var(--color-border-subtle)]/50 bg-[var(--color-surface-0)]/40 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            <Brain className="size-3" />
            <span>Reasoning</span>
            {phase === 'streaming' && !content && (
              <span className="ml-0.5 flex gap-[3px]">
                <span className="thinking-dot inline-block size-[3px] rounded-full bg-[var(--color-text-muted)]" />
                <span className="thinking-dot inline-block size-[3px] rounded-full bg-[var(--color-text-muted)]" />
                <span className="thinking-dot inline-block size-[3px] rounded-full bg-[var(--color-text-muted)]" />
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]/70 italic line-clamp-2">
            {thinkingContent.slice(-200)}
          </p>
        </div>
      )}

      {/* Main response content */}
      {content && (
        <div className="px-5 py-3.5">
          <div className="markdown-content text-[13px] leading-[1.7] text-[var(--color-text-primary)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Streaming indicator when no content yet */}
      {phase === 'streaming' && !content && !thinkingContent && (
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="flex gap-[3px]">
            <span className="thinking-dot inline-block size-[5px] rounded-full bg-[var(--color-accent)]" />
            <span className="thinking-dot inline-block size-[5px] rounded-full bg-[var(--color-accent)]" />
            <span className="thinking-dot inline-block size-[5px] rounded-full bg-[var(--color-accent)]" />
          </span>
          <span className="text-[12px] text-[var(--color-text-muted)]">Generating…</span>
        </div>
      )}
    </div>
  );
}
