import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import type { ActiveSubagent } from '@renderer/lib/subagentTracker';

function formatElapsed(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
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
}

function SubagentActivityCard({ subagent }: SubagentActivityCardProps) {
  const borderClass =
    subagent.status === 'running'
      ? 'border-[var(--color-accent-sky)]/20'
      : subagent.status === 'failed'
        ? 'border-[var(--color-status-error)]/20'
        : 'border-[var(--color-status-success)]/20';

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-[var(--color-glass)] px-3 py-1.5 transition-all duration-200 ${borderClass}`}
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
  if (subagents.length === 0) return null;

  // Only show running subagents in the chat stream
  const visible = subagents.filter((s) => s.status === 'running');
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 py-1" aria-label="Active sub-agents">
      {visible.map((subagent) => (
        <SubagentActivityCard key={subagent.toolCallId} subagent={subagent} />
      ))}
    </div>
  );
}
