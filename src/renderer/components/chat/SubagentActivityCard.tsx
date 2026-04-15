import { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import type { ActiveSubagent } from '@renderer/lib/subagentTracker';

const COMPLETION_GRACE_MS = 3000;

import { formatElapsedMs } from '@renderer/hooks/useElapsedTimer';

function formatElapsed(startedAt: string, endedAt?: string): string {
  const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
  const durationMs = endMs - new Date(startedAt).getTime();
  return formatElapsedMs(durationMs);
}

function StatusIcon({ status }: { status: ActiveSubagent['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="size-3.5 animate-spin text-[var(--color-accent-sky)]" aria-label="Running" />;
    case 'completed':
      return <CheckCircle2 className="size-3.5 text-[var(--color-status-success)]" aria-label="Completed" />;
    case 'failed':
      return <XCircle className="size-3.5 text-[var(--color-status-error)]" aria-label="Failed" />;
  }
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(startedAt));

  useEffect(() => {
    const id = setInterval(() => setElapsed(formatElapsed(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[var(--color-text-muted)]">{elapsed}</span>
  );
}

interface SubagentActivityCardProps {
  subagent: ActiveSubagent;
  fading?: boolean;
}

function SubagentActivityCard({ subagent, fading }: SubagentActivityCardProps) {
  const borderClass =
    subagent.status === 'running'
      ? 'border-[var(--color-accent-sky)]/20'
      : subagent.status === 'failed'
        ? 'border-[var(--color-status-error)]/20'
        : 'border-[var(--color-status-success)]/20';

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-[var(--color-glass)] px-3 py-1.5 transition-all duration-300 ${borderClass} ${fading ? 'opacity-0' : 'opacity-100'}`}
      role="status"
      aria-label={`Sub-agent ${subagent.name}: ${subagent.activityLabel}`}
    >
      <StatusIcon status={subagent.status} />
      <Bot className="size-3 text-[var(--color-text-muted)]" />
      <span className="text-[11px] font-medium text-[var(--color-text-primary)]">{subagent.name}</span>
      <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
      <span className="text-[10px] text-[var(--color-text-secondary)]">{subagent.activityLabel}</span>
      {subagent.status === 'running' && <ElapsedTimer startedAt={subagent.startedAt} />}
      {subagent.error && (
        <span className="truncate text-[10px] text-[var(--color-status-error)]" title={subagent.error}>
          {subagent.error}
        </span>
      )}
    </div>
  );
}

interface SubagentActivityListProps {
  subagents: ReadonlyArray<ActiveSubagent>;
}

export function SubagentActivityList({ subagents }: SubagentActivityListProps) {
  // Track recently-completed subagent IDs so we can show them briefly
  const [recentlyDone, setRecentlyDone] = useState<Set<string>>(new Set());
  const [fading, setFading] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    for (const sub of subagents) {
      if (sub.status !== 'running' && !recentlyDone.has(sub.toolCallId) && !timersRef.current.has(sub.toolCallId)) {
        // Newly completed — track it
        setRecentlyDone((prev) => new Set(prev).add(sub.toolCallId));

        const fadeTimer = setTimeout(() => {
          setFading((prev) => new Set(prev).add(sub.toolCallId));
        }, COMPLETION_GRACE_MS - 300);

        const removeTimer = setTimeout(() => {
          setRecentlyDone((prev) => {
            const next = new Set(prev);
            next.delete(sub.toolCallId);
            return next;
          });
          setFading((prev) => {
            const next = new Set(prev);
            next.delete(sub.toolCallId);
            return next;
          });
          timersRef.current.delete(sub.toolCallId);
        }, COMPLETION_GRACE_MS);

        timersRef.current.set(sub.toolCallId, removeTimer);
        // Store fade timer for cleanup
        timersRef.current.set(`fade-${sub.toolCallId}`, fadeTimer);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subagents]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  if (subagents.length === 0) return null;

  // Show running subagents + recently-completed ones within the grace period
  const visible = subagents.filter(
    (s) => s.status === 'running' || recentlyDone.has(s.toolCallId),
  );
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 py-1" aria-label="Active sub-agents">
      {visible.map((subagent) => (
        <SubagentActivityCard
          key={subagent.toolCallId}
          subagent={subagent}
          fading={fading.has(subagent.toolCallId)}
        />
      ))}
    </div>
  );
}
