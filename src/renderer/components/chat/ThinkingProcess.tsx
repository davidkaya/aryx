import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

import type { ChatMessageRecord } from '@shared/domain/session';

interface ThinkingProcessProps {
  messages: ChatMessageRecord[];
  isActive: boolean;
  turnStartedAt?: string;
}

export function ThinkingProcess({ messages, isActive, turnStartedAt }: ThinkingProcessProps) {
  const [expanded, setExpanded] = useState(false);
  const wasActiveRef = useRef(isActive);

  // Auto-expand when the turn is active and thinking messages appear.
  // Auto-collapse once the turn finishes.
  useEffect(() => {
    if (isActive && messages.length > 0) {
      setExpanded(true);
    } else if (wasActiveRef.current && !isActive) {
      setExpanded(false);
    }
    wasActiveRef.current = isActive;
  }, [isActive, messages.length]);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const elapsed = useMemo(() => {
    if (!turnStartedAt || messages.length === 0) return undefined;
    const start = new Date(turnStartedAt).getTime();
    const lastMessage = messages[messages.length - 1];
    const end = isActive ? Date.now() : new Date(lastMessage.createdAt).getTime();
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    if (seconds < 2) return undefined;
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  }, [turnStartedAt, messages, isActive]);

  if (messages.length === 0) {
    return null;
  }

  const stepCount = messages.length;
  const summaryParts: string[] = [];
  if (elapsed) summaryParts.push(`${elapsed}`);
  summaryParts.push(`${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`);

  return (
    <div className="thinking-process-enter mb-2 overflow-hidden rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-surface-1)]/60">
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); toggle(); } }}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)]/50"
      >
        <Brain className="size-3.5 shrink-0 text-[var(--color-accent-purple)]" />
        {isActive ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--color-text-secondary)]">Thinking</span>
            <ThinkingPulse />
          </span>
        ) : (
          <span className="text-[var(--color-text-secondary)]">
            Thought for {summaryParts.join(' · ')}
          </span>
        )}
        <span className="ml-auto shrink-0">
          {expanded
            ? <ChevronDown className="size-3 text-[var(--color-text-muted)]" />
            : <ChevronRight className="size-3 text-[var(--color-text-muted)]" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border)]/30 px-3 py-2">
          <div className="space-y-1.5">
            {messages.map((message) => (
              <ThinkingStep key={message.id} message={message} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThinkingStep({ message }: { message: ChatMessageRecord }) {
  const preview = useMemo(() => truncatePreview(message.content, 180), [message.content]);

  return (
    <div className="flex gap-2 text-[12px] leading-relaxed">
      <span className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">▸</span>
      <div className="min-w-0">
        {message.authorName && (
          <span className="mr-1.5 font-medium text-[var(--color-text-secondary)]">
            {message.authorName}
          </span>
        )}
        <span className="text-[var(--color-text-muted)]">{preview}</span>
      </div>
    </div>
  );
}

function ThinkingPulse() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent-purple)]" />
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent-purple)]" />
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent-purple)]" />
    </span>
  );
}

function truncatePreview(text: string, maxLength: number): string {
  const firstLine = text.split('\n')[0] ?? '';
  const cleaned = firstLine.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}…`;
}
