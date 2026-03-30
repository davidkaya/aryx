import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  MessageSquare,
  Play,
  Wrench,
  XCircle,
} from 'lucide-react';

import {
  collapseTimelineEvents,
  formatEventLabel,
  formatRunDuration,
  formatRunStatusLabel,
  formatRunTimestamp,
  isTerminalEvent,
  truncateContent,
  type CollapsedTimelineEvent,
} from '@renderer/lib/runTimelineFormatting';
import type { OrchestrationMode } from '@shared/domain/pattern';
import type { RunTimelineEventRecord, SessionRunRecord } from '@shared/domain/runTimeline';
import { FileChangePreview } from '@renderer/components/chat/FileChangePreview';

/* ── Mode accent colours (shared with ActivityPanel) ───────── */

const modeAccent: Record<OrchestrationMode, { dot: string; ring: string; text: string }> = {
  single:       { dot: 'bg-[#245CF9]',                       ring: 'ring-[#245CF9]/30',                       text: 'text-[#245CF9]' },
  sequential:   { dot: 'bg-[var(--color-status-warning)]',   ring: 'ring-[var(--color-status-warning)]/30',   text: 'text-[var(--color-status-warning)]' },
  concurrent:   { dot: 'bg-[var(--color-status-success)]',   ring: 'ring-[var(--color-status-success)]/30',   text: 'text-[var(--color-status-success)]' },
  handoff:      { dot: 'bg-[var(--color-accent-sky)]',       ring: 'ring-[var(--color-accent-sky)]/30',       text: 'text-[var(--color-accent-sky)]' },
  'group-chat': { dot: 'bg-[var(--color-accent-purple)]',   ring: 'ring-[var(--color-accent-purple)]/30',   text: 'text-[var(--color-accent-purple)]' },
  magentic:     { dot: 'bg-[var(--color-text-muted)]',       ring: 'ring-[var(--color-text-muted)]/30',       text: 'text-[var(--color-text-muted)]' },
};

/* ── Status badges ─────────────────────────────────────────── */

const runStatusStyles: Record<SessionRunRecord['status'], { icon: ReactNode; className: string }> = {
  running:   { icon: <CircleDot className="size-3" />, className: 'text-[var(--color-status-info)]' },
  completed: { icon: <CheckCircle2 className="size-3" />, className: 'text-[var(--color-status-success)]' },
  cancelled: { icon: <XCircle className="size-3" />, className: 'text-[var(--color-text-muted)]' },
  error:     { icon: <XCircle className="size-3" />, className: 'text-[var(--color-status-error)]' },
};

/* ── Event node icon ───────────────────────────────────────── */

function EventIcon({ kind, status }: { kind: RunTimelineEventRecord['kind']; status: RunTimelineEventRecord['status'] }) {
  const isRunning = status === 'running';
  const base = 'size-2.5';

  // Running events use white icons to contrast with the brand-gradient circle
  if (isRunning) {
    const pulse = 'animate-pulse';
    switch (kind) {
      case 'thinking':
        return <Brain className={`${base} ${pulse} text-white`} />;
      case 'approval':
        return <AlertTriangle className={`${base} ${pulse} text-white`} />;
      case 'message':
        return <MessageSquare className={`${base} ${pulse} text-white`} />;
      default:
        return <Play className={`${base} text-white`} />;
    }
  }

  switch (kind) {
    case 'run-started':
      return <Play className={`${base} text-[var(--color-text-muted)]`} />;
    case 'thinking':
      return <Brain className={`${base} text-[var(--color-text-muted)]`} />;
    case 'handoff':
      return <ArrowRight className={`${base} text-[var(--color-status-warning)]`} />;
    case 'tool-call':
      return <Wrench className={`${base} text-[var(--color-accent-purple)]`} />;
    case 'approval':
      return <AlertTriangle className={`${base} ${status === 'error' ? 'text-[var(--color-status-error)]' : 'text-[var(--color-status-success)]'}`} />;
    case 'message':
      return <MessageSquare className={`${base} ${status === 'error' ? 'text-[var(--color-status-error)]' : 'text-[var(--color-status-success)]'}`} />;
    case 'run-completed':
      return <CheckCircle2 className={`${base} text-[var(--color-status-success)]`} />;
    case 'run-cancelled':
      return <XCircle className={`${base} text-[var(--color-text-muted)]`} />;
    case 'run-failed':
      return <AlertTriangle className={`${base} text-[var(--color-status-error)]`} />;
  }
}

/* ── Single timeline event row ─────────────────────────────── */

function TimelineEventRow({
  event,
  isLast,
  onJumpToMessage,
}: {
  event: RunTimelineEventRecord;
  isLast: boolean;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const label = formatEventLabel(event);
  const timestamp = formatRunTimestamp(event.updatedAt ?? event.occurredAt);
  const preview = event.kind === 'message' ? truncateContent(event.content) : undefined;
  const isClickable = !!onJumpToMessage && !!event.messageId;
  const terminal = isTerminalEvent(event.kind);

  return (
    <div className="relative">
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[9px] top-[22px] bottom-0 w-px bg-[var(--color-border)]" />
      )}

      <button
        className={`group flex w-full gap-2.5 text-left transition-all duration-200 ${terminal ? 'py-1' : 'py-1.5'} ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
        disabled={!isClickable}
        onClick={isClickable ? () => onJumpToMessage(event.messageId!) : undefined}
        type="button"
      >
        {/* Node */}
        <div className="relative z-10 flex shrink-0 items-start pt-0.5">
          <div className={`flex size-[18px] items-center justify-center rounded-full ${event.status === 'running' ? 'brand-gradient-bg' : 'bg-[var(--color-surface-2)]'}`}>
            <EventIcon kind={event.kind} status={event.status} />
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-medium ${terminal ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'} ${isClickable ? 'group-hover:text-[var(--color-text-accent)]' : ''}`}>
              {label}
            </span>
            {/* Approval kind badge */}
            {event.kind === 'approval' && event.approvalKind && (
              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${
                event.status === 'running'
                  ? 'bg-[var(--color-status-warning)]/15 text-[var(--color-status-warning)]'
                  : event.status === 'completed'
                    ? 'bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]'
                    : 'bg-[var(--color-status-error)]/15 text-[var(--color-status-error)]'
              }`}>
                {event.approvalKind === 'final-response' ? 'response' : 'tool'}
              </span>
            )}
            <span className="font-mono ml-auto shrink-0 text-[9px] tabular-nums text-[var(--color-text-muted)]">{timestamp}</span>
          </div>

          {/* Content preview for message events */}
          {preview && (
            <p className={`mt-0.5 text-[10px] leading-snug text-[var(--color-text-muted)] ${isClickable ? 'group-hover:text-[var(--color-text-secondary)]' : ''}`}>
              {preview}
            </p>
          )}

          {/* Approval detail */}
          {event.kind === 'approval' && event.approvalDetail && (
            <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-text-muted)]">
              {truncateContent(event.approvalDetail, 120)}
            </p>
          )}

          {/* Error detail */}
          {event.error && (
            <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-status-error)]/80">
              {truncateContent(event.error, 120)}
            </p>
          )}
        </div>
      </button>

      {/* File change preview for tool-call events */}
      {event.kind === 'tool-call' && event.fileChanges && event.fileChanges.length > 0 && (
        <div className="relative z-10 ml-[25px] pb-1">
          <FileChangePreview fileChanges={event.fileChanges} />
        </div>
      )}
    </div>
  );
}

/* ── Collapsed thinking group ──────────────────────────────── */

function ThinkingGroupRow({
  events,
  agentName,
  isLast,
}: {
  events: RunTimelineEventRecord[];
  agentName: string;
  isLast: boolean;
}) {
  return (
    <div className="group relative flex w-full gap-2.5 py-1">
      {!isLast && (
        <div className="absolute left-[9px] top-[22px] bottom-0 w-px bg-[var(--color-border)]" />
      )}
      <div className="relative z-10 flex shrink-0 items-start pt-0.5">
        <div className="flex size-[18px] items-center justify-center rounded-full bg-[var(--color-surface-2)]">
          <Brain className="size-2.5 text-[var(--color-text-muted)]" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {agentName ? `${agentName} thinking` : 'Thinking'} ×{events.length}
        </span>
      </div>
    </div>
  );
}

/* ── Collapsed event dispatcher ────────────────────────────── */

function CollapsedEventRow({
  item,
  isLast,
  onJumpToMessage,
}: {
  item: CollapsedTimelineEvent;
  isLast: boolean;
  onJumpToMessage?: (messageId: string) => void;
}) {
  if (item.type === 'thinking-group') {
    return <ThinkingGroupRow agentName={item.agentName} events={item.events} isLast={isLast} />;
  }
  return <TimelineEventRow event={item.event} isLast={isLast} onJumpToMessage={onJumpToMessage} />;
}

/* ── Run card ──────────────────────────────────────────────── */

function RunCard({
  run,
  expanded,
  onToggle,
  onJumpToMessage,
}: {
  run: SessionRunRecord;
  expanded: boolean;
  onToggle: () => void;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const accent = modeAccent[run.patternMode] ?? modeAccent.single;
  const statusStyle = runStatusStyles[run.status];
  const duration = formatRunDuration(run.startedAt, run.completedAt);

  const collapsedEvents = useMemo(
    () => collapseTimelineEvents(run.events),
    [run.events],
  );

  return (
    <div className="glass-surface rounded-lg">
      {/* Run header */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-all duration-200 hover:bg-[var(--color-surface-3)]"
        onClick={onToggle}
        type="button"
      >
        {expanded
          ? <ChevronDown className="size-3 shrink-0 text-[var(--color-text-muted)]" />
          : <ChevronRight className="size-3 shrink-0 text-[var(--color-text-muted)]" />}

        <Bot className={`size-3 shrink-0 ${accent.text}`} />

        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--color-text-secondary)]">
          {run.patternName}
        </span>

        {/* Status */}
        <span className={`flex items-center gap-1 shrink-0 ${statusStyle.className}`}>
          {run.status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-[var(--color-status-info)]" />}
          {run.status !== 'running' && statusStyle.icon}
          <span className="text-[9px] font-medium">{formatRunStatusLabel(run.status)}</span>
        </span>
      </button>

      {/* Expanded timeline */}
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-3 pb-2 pt-1.5">
          {/* Agent badges */}
          {run.agents.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {run.agents.map((agent) => (
                <span
                  className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)]"
                  key={agent.agentId}
                >
                  {agent.agentName}
                </span>
              ))}
            </div>
          )}

          {/* Timeline events */}
          <div>
            {collapsedEvents.map((item, index) => (
              <CollapsedEventRow
                isLast={index === collapsedEvents.length - 1}
                item={item}
                key={item.type === 'single' ? item.event.id : `thinking-${item.events[0].id}`}
                onJumpToMessage={onJumpToMessage}
              />
            ))}
          </div>

          {/* Duration footer */}
          {duration && (
            <div className="font-mono mt-1 border-t border-[var(--color-border-subtle)] pt-1.5 text-[9px] tabular-nums text-[var(--color-text-muted)]">
              Duration: {duration}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────── */

function EmptyTimeline() {
  return (
    <p className="py-4 text-center text-[11px] text-[var(--color-text-muted)]">
      Send a message to see the run timeline
    </p>
  );
}

/* ── Main export ───────────────────────────────────────────── */

interface RunTimelineProps {
  runs: readonly SessionRunRecord[];
  onJumpToMessage?: (messageId: string) => void;
}

export function RunTimeline({ runs, onJumpToMessage }: RunTimelineProps) {
  const latestRunId = runs.length > 0 ? runs[0].id : undefined;
  const [expandedRunId, setExpandedRunId] = useState<string | undefined>(latestRunId);

  // Auto-expand the latest run when it changes
  useEffect(() => {
    setExpandedRunId(latestRunId);
  }, [latestRunId]);

  if (runs.length === 0) {
    return <EmptyTimeline />;
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <RunCard
          expanded={expandedRunId === run.id}
          key={run.id}
          onJumpToMessage={onJumpToMessage}
          onToggle={() => setExpandedRunId(expandedRunId === run.id ? undefined : run.id)}
          run={run}
        />
      ))}
    </div>
  );
}
