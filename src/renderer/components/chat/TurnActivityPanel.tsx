import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  ShieldAlert,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';

import { useElapsedTimer } from '@renderer/hooks/useElapsedTimer';
import { FileChangePreview } from '@renderer/components/chat/FileChangePreview';
import { RunChangeSummaryCard } from '@renderer/components/chat/RunChangeSummaryCard';
import { formatEventLabel, truncateContent } from '@renderer/lib/runTimelineFormatting';
import type { ChatMessageRecord } from '@shared/domain/session';
import type { ProjectGitFileReference } from '@shared/domain/project';
import type { RunTimelineEventRecord, SessionRunRecord } from '@shared/domain/runTimeline';

/* ── Types ─────────────────────────────────────────────────── */

/** A unified activity stream item, merging chat thinking messages
 *  and run timeline events into a single chronological list. */
type ActivityStreamItem =
  | { kind: 'thinking-step'; message: ChatMessageRecord }
  | { kind: 'timeline-event'; event: RunTimelineEventRecord };

/** Events to skip in the inline panel (redundant or implicit). */
const SKIP_EVENT_KINDS = new Set(['run-started', 'thinking']);

/* ── Props ─────────────────────────────────────────────────── */

export interface TurnActivityPanelProps {
  thinkingMessages: ChatMessageRecord[];
  run?: SessionRunRecord;
  isActive: boolean;
  turnStartedAt?: string;
  sessionId: string;
  onDiscard?: (sessionId: string, runId: string, files?: ProjectGitFileReference[]) => Promise<unknown>;
  onOpenCommitComposer?: () => void;
}

/* ── Helpers ───────────────────────────────────────────────── */

function truncatePreview(text: string, maxLength: number): string {
  const firstLine = text.split('\n')[0] ?? '';
  const cleaned = firstLine.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}…`;
}

function buildActivityStream(
  thinkingMessages: ChatMessageRecord[],
  events: readonly RunTimelineEventRecord[],
): ActivityStreamItem[] {
  const items: ActivityStreamItem[] = [];

  for (const msg of thinkingMessages) {
    items.push({ kind: 'thinking-step', message: msg });
  }

  for (const event of events) {
    if (SKIP_EVENT_KINDS.has(event.kind)) continue;
    items.push({ kind: 'timeline-event', event });
  }

  // Sort chronologically by timestamp
  items.sort((a, b) => {
    const tsA = a.kind === 'thinking-step' ? a.message.createdAt : a.event.occurredAt;
    const tsB = b.kind === 'thinking-step' ? b.message.createdAt : b.event.occurredAt;
    return new Date(tsA).getTime() - new Date(tsB).getTime();
  });

  return items;
}

interface ActivitySummary {
  thinkingSteps: number;
  toolCalls: number;
  handoffs: number;
  approvals: number;
  hasError: boolean;
}

function summarizeActivity(
  thinkingMessages: ChatMessageRecord[],
  run?: SessionRunRecord,
): ActivitySummary {
  const thinkingSteps = thinkingMessages.filter((m) => m.content).length;
  let toolCalls = 0;
  let handoffs = 0;
  let approvals = 0;
  let hasError = false;

  if (run) {
    for (const e of run.events) {
      if (e.kind === 'tool-call') toolCalls++;
      else if (e.kind === 'handoff') handoffs++;
      else if (e.kind === 'approval') approvals++;
      else if (e.kind === 'run-failed') hasError = true;
    }
  }

  return { thinkingSteps, toolCalls, handoffs, approvals, hasError };
}

function formatSummaryParts(summary: ActivitySummary): string[] {
  const parts: string[] = [];
  if (summary.toolCalls > 0) {
    parts.push(`${summary.toolCalls} tool ${summary.toolCalls === 1 ? 'call' : 'calls'}`);
  }
  if (summary.handoffs > 0) {
    parts.push(`${summary.handoffs} ${summary.handoffs === 1 ? 'handoff' : 'handoffs'}`);
  }
  if (summary.approvals > 0) {
    parts.push(`${summary.approvals} ${summary.approvals === 1 ? 'approval' : 'approvals'}`);
  }
  if (summary.thinkingSteps > 0) {
    parts.push(`${summary.thinkingSteps} thinking ${summary.thinkingSteps === 1 ? 'step' : 'steps'}`);
  }
  return parts;
}

/* ── Event icon ────────────────────────────────────────────── */

function ActivityEventIcon({ kind, status }: { kind: RunTimelineEventRecord['kind']; status: RunTimelineEventRecord['status'] }) {
  const base = 'size-3 shrink-0';

  switch (kind) {
    case 'tool-call':
      return <Wrench className={`${base} text-[var(--color-accent-purple)]`} />;
    case 'approval':
      return (
        <ShieldAlert
          className={`${base} ${
            status === 'error'
              ? 'text-[var(--color-status-error)]'
              : status === 'running'
                ? 'text-[var(--color-status-warning)]'
                : 'text-[var(--color-status-success)]'
          }`}
        />
      );
    case 'handoff':
      return <ArrowRight className={`${base} text-[var(--color-status-warning)]`} />;
    case 'message':
      return <MessageSquare className={`${base} text-[var(--color-accent-sky)]`} />;
    case 'run-completed':
      return <CheckCircle2 className={`${base} text-[var(--color-status-success)]`} />;
    case 'run-cancelled':
      return <XCircle className={`${base} text-[var(--color-text-muted)]`} />;
    case 'run-failed':
      return <AlertTriangle className={`${base} text-[var(--color-status-error)]`} />;
    default:
      return <Zap className={`${base} text-[var(--color-text-muted)]`} />;
  }
}

/* ── Activity event row ────────────────────────────────────── */

function ActivityTimelineEventRow({ event }: { event: RunTimelineEventRecord }) {
  const label = formatEventLabel(event);
  const isTerminal = event.kind === 'run-completed' || event.kind === 'run-cancelled' || event.kind === 'run-failed';

  return (
    <div className="turn-activity-row flex gap-2 py-1">
      <div className="mt-0.5 flex shrink-0 items-start">
        <ActivityEventIcon kind={event.kind} status={event.status} />
      </div>
      <div className="min-w-0 flex-1">
        <span className={`text-[12px] font-medium ${isTerminal ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}>
          {label}
        </span>

        {/* Approval kind badge */}
        {event.kind === 'approval' && event.approvalKind && (
          <span
            className={`ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${
              event.status === 'running'
                ? 'bg-[var(--color-status-warning)]/15 text-[var(--color-status-warning)]'
                : event.status === 'completed'
                  ? 'bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]'
                  : 'bg-[var(--color-status-error)]/15 text-[var(--color-status-error)]'
            }`}
          >
            {event.approvalKind === 'final-response' ? 'response' : 'tool'}
          </span>
        )}

        {/* Content preview for message events */}
        {event.kind === 'message' && event.content && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
            {truncateContent(event.content, 120)}
          </p>
        )}

        {/* Approval detail */}
        {event.kind === 'approval' && event.approvalDetail && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
            {truncateContent(event.approvalDetail, 120)}
          </p>
        )}

        {/* Error detail */}
        {event.error && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-status-error)]/80">
            {truncateContent(event.error, 120)}
          </p>
        )}

        {/* File change preview for tool-call events */}
        {event.kind === 'tool-call' && event.fileChanges && event.fileChanges.length > 0 && (
          <div className="mt-1">
            <FileChangePreview fileChanges={event.fileChanges} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Thinking step row ─────────────────────────────────────── */

function ThinkingStepRow({ message }: { message: ChatMessageRecord }) {
  const preview = useMemo(() => truncatePreview(message.content, 180), [message.content]);

  if (message.pending && !message.content) return null;

  return (
    <div className="turn-activity-row flex gap-2 py-1">
      <div className="mt-0.5 flex shrink-0 items-start">
        <Brain className="size-3 text-[var(--color-accent-purple)]" />
      </div>
      <div className="min-w-0 flex-1">
        {message.authorName && (
          <span className="mr-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
            {message.authorName}
          </span>
        )}
        <span className="text-[12px] text-[var(--color-text-muted)]">{preview}</span>
      </div>
    </div>
  );
}

/* ── Active pulse dots ─────────────────────────────────────── */

function ActivityPulse() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent)]" />
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent)]" />
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent)]" />
    </span>
  );
}

/* ── Main component ────────────────────────────────────────── */

export function TurnActivityPanel({
  thinkingMessages,
  run,
  isActive,
  turnStartedAt,
  sessionId,
  onDiscard,
  onOpenCommitComposer,
}: TurnActivityPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const wasActiveRef = useRef(isActive);

  // Auto-expand when the turn is active and activity appears.
  // Auto-collapse once the turn finishes.
  useEffect(() => {
    const hasActivity = thinkingMessages.length > 0 || (run?.events.length ?? 0) > 0;
    if (isActive && hasActivity) {
      setExpanded(true);
    } else if (wasActiveRef.current && !isActive) {
      setExpanded(false);
    }
    wasActiveRef.current = isActive;
  }, [isActive, thinkingMessages.length, run?.events.length]);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const elapsed = useElapsedTimer(
    thinkingMessages.length > 0 || run ? turnStartedAt : undefined,
    isActive,
  );

  const summary = useMemo(
    () => summarizeActivity(thinkingMessages, run),
    [thinkingMessages, run],
  );

  const activityStream = useMemo(
    () => buildActivityStream(thinkingMessages, run?.events ?? []),
    [thinkingMessages, run?.events],
  );

  // Nothing to show yet
  if (thinkingMessages.length === 0 && (!run || run.events.length === 0)) {
    return null;
  }

  const summaryParts = formatSummaryParts(summary);
  const runStatus = run?.status;
  const isCompleted = runStatus === 'completed';
  const isFailed = runStatus === 'error';
  const isCancelled = runStatus === 'cancelled';
  const isTerminated = isCompleted || isFailed || isCancelled;
  const showGitSummary = run && isTerminated && run.postRunGitSummary && onDiscard;

  // Build the summary label
  let summaryLabel: string;
  if (isActive) {
    summaryLabel = 'Working';
  } else if (isFailed) {
    summaryLabel = elapsed ? `Failed after ${elapsed}` : 'Failed';
  } else if (isCancelled) {
    summaryLabel = elapsed ? `Cancelled after ${elapsed}` : 'Cancelled';
  } else if (elapsed) {
    summaryLabel = `Completed in ${elapsed}`;
  } else {
    summaryLabel = 'Completed';
  }

  const statusColorClass = isFailed
    ? 'text-[var(--color-status-error)]'
    : isCancelled
      ? 'text-[var(--color-text-muted)]'
      : isActive
        ? 'text-[var(--color-text-secondary)]'
        : 'text-[var(--color-text-secondary)]';

  return (
    <div
      className={`turn-activity-enter overflow-hidden rounded-lg border bg-[var(--color-surface-1)]/60 transition-colors duration-200 ${
        isActive
          ? 'border-[var(--color-accent)]/30'
          : isFailed
            ? 'border-[var(--color-status-error)]/20'
            : 'border-[var(--color-border)]/50'
      }`}
    >
      {/* Summary header */}
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); toggle(); } }}
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--color-surface-2)]/50 ${
          isActive ? 'bg-[var(--color-accent)]/[0.04]' : ''
        }`}
      >
        <Zap className={`size-3.5 shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`} />

        {isActive ? (
          <span className="flex items-center gap-1.5">
            <span className={statusColorClass}>{summaryLabel}</span>
            <ActivityPulse />
          </span>
        ) : (
          <span className={statusColorClass}>{summaryLabel}</span>
        )}

        {/* Inline counters */}
        {summaryParts.length > 0 && (
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
            {'· '}
            {summaryParts.join(' · ')}
          </span>
        )}

        <span className="ml-auto shrink-0">
          {expanded
            ? <ChevronDown className="size-3 text-[var(--color-text-muted)]" />
            : <ChevronRight className="size-3 text-[var(--color-text-muted)]" />}
        </span>
      </button>

      {/* Expanded activity stream */}
      {expanded && (
        <div className="border-t border-[var(--color-border)]/30 px-3 py-2">
          <div className="space-y-0.5">
            {activityStream.map((item) => {
              if (item.kind === 'thinking-step') {
                return <ThinkingStepRow key={item.message.id} message={item.message} />;
              }
              return <ActivityTimelineEventRow key={item.event.id} event={item.event} />;
            })}
          </div>

          {/* Post-run git changes */}
          {showGitSummary && (
            <div className="mt-2 border-t border-[var(--color-border)]/30 pt-2">
              <RunChangeSummaryCard
                onDiscard={onDiscard}
                onOpenCommitComposer={onOpenCommitComposer}
                runId={run.requestId}
                sessionId={sessionId}
                summary={run.postRunGitSummary!}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
