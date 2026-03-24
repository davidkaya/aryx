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

/* ── Mode accent colours (shared with ActivityPanel) ───────── */

const modeAccent: Record<OrchestrationMode, { dot: string; ring: string; text: string }> = {
  single:       { dot: 'bg-indigo-400',  ring: 'ring-indigo-500/30', text: 'text-indigo-400' },
  sequential:   { dot: 'bg-amber-400',   ring: 'ring-amber-500/30',  text: 'text-amber-400' },
  concurrent:   { dot: 'bg-emerald-400', ring: 'ring-emerald-500/30', text: 'text-emerald-400' },
  handoff:      { dot: 'bg-sky-400',     ring: 'ring-sky-500/30',    text: 'text-sky-400' },
  'group-chat': { dot: 'bg-violet-400',  ring: 'ring-violet-500/30', text: 'text-violet-400' },
  magentic:     { dot: 'bg-zinc-500',    ring: 'ring-zinc-600/30',   text: 'text-zinc-500' },
};

/* ── Status badges ─────────────────────────────────────────── */

const runStatusStyles: Record<SessionRunRecord['status'], { icon: ReactNode; className: string }> = {
  running:   { icon: <CircleDot className="size-3" />, className: 'text-blue-400' },
  completed: { icon: <CheckCircle2 className="size-3" />, className: 'text-emerald-400' },
  error:     { icon: <XCircle className="size-3" />, className: 'text-red-400' },
};

/* ── Event node icon ───────────────────────────────────────── */

function EventIcon({ kind, status }: { kind: RunTimelineEventRecord['kind']; status: RunTimelineEventRecord['status'] }) {
  const base = 'size-3.5';
  switch (kind) {
    case 'run-started':
      return <Play className={`${base} text-zinc-500`} />;
    case 'thinking':
      return <Brain className={`${base} ${status === 'running' ? 'text-sky-400 animate-pulse' : 'text-zinc-500'}`} />;
    case 'handoff':
      return <ArrowRight className={`${base} text-amber-400`} />;
    case 'tool-call':
      return <Wrench className={`${base} text-violet-400`} />;
    case 'approval':
      return <AlertTriangle className={`${base} ${status === 'running' ? 'text-amber-400 animate-pulse' : status === 'error' ? 'text-red-400' : 'text-emerald-400'}`} />;
    case 'message':
      return <MessageSquare className={`${base} ${status === 'running' ? 'text-blue-400 animate-pulse' : status === 'error' ? 'text-red-400' : 'text-emerald-400'}`} />;
    case 'run-completed':
      return <CheckCircle2 className={`${base} text-emerald-400`} />;
    case 'run-failed':
      return <AlertTriangle className={`${base} text-red-400`} />;
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
    <button
      className={`group relative flex w-full gap-2.5 text-left ${terminal ? 'py-1' : 'py-1.5'} ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
      disabled={!isClickable}
      onClick={isClickable ? () => onJumpToMessage(event.messageId!) : undefined}
      type="button"
    >
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[7px] top-[22px] bottom-0 w-px bg-zinc-800" />
      )}

      {/* Node */}
      <div className="relative z-10 flex shrink-0 items-start pt-0.5">
        <div className="flex size-[15px] items-center justify-center rounded-full bg-[var(--color-surface-1)]">
          <EventIcon kind={event.kind} status={event.status} />
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-medium ${terminal ? 'text-zinc-600' : 'text-zinc-300'} ${isClickable ? 'group-hover:text-indigo-300' : ''}`}>
            {label}
          </span>
          {/* Approval kind badge */}
          {event.kind === 'approval' && event.approvalKind && (
            <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${
              event.status === 'running'
                ? 'bg-amber-500/15 text-amber-400'
                : event.status === 'completed'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-red-500/15 text-red-400'
            }`}>
              {event.approvalKind === 'final-response' ? 'response' : 'tool'}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[9px] tabular-nums text-zinc-700">{timestamp}</span>
        </div>

        {/* Content preview for message events */}
        {preview && (
          <p className={`mt-0.5 text-[10px] leading-snug text-zinc-600 ${isClickable ? 'group-hover:text-zinc-500' : ''}`}>
            {preview}
          </p>
        )}

        {/* Approval detail */}
        {event.kind === 'approval' && event.approvalDetail && (
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
            {truncateContent(event.approvalDetail, 120)}
          </p>
        )}

        {/* Error detail */}
        {event.error && (
          <p className="mt-0.5 text-[10px] leading-snug text-red-500/80">
            {truncateContent(event.error, 120)}
          </p>
        )}
      </div>
    </button>
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
        <div className="absolute left-[7px] top-[22px] bottom-0 w-px bg-zinc-800" />
      )}
      <div className="relative z-10 flex shrink-0 items-start pt-0.5">
        <div className="flex size-[15px] items-center justify-center rounded-full bg-[var(--color-surface-1)]">
          <Brain className="size-3.5 text-zinc-500" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] text-zinc-600">
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      {/* Run header */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-zinc-800/30"
        onClick={onToggle}
        type="button"
      >
        {expanded
          ? <ChevronDown className="size-3 shrink-0 text-zinc-600" />
          : <ChevronRight className="size-3 shrink-0 text-zinc-600" />}

        <Bot className={`size-3 shrink-0 ${accent.text}`} />

        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-300">
          {run.patternName}
        </span>

        {/* Status */}
        <span className={`flex items-center gap-1 shrink-0 ${statusStyle.className}`}>
          {run.status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-blue-400" />}
          {run.status !== 'running' && statusStyle.icon}
          <span className="text-[9px] font-medium">{formatRunStatusLabel(run.status)}</span>
        </span>
      </button>

      {/* Expanded timeline */}
      {expanded && (
        <div className="border-t border-zinc-800/60 px-3 pb-2 pt-1.5">
          {/* Agent badges */}
          {run.agents.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {run.agents.map((agent) => (
                <span
                  className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[9px] font-medium text-zinc-500"
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
            <div className="mt-1 border-t border-zinc-800/40 pt-1.5 text-[9px] tabular-nums text-zinc-700">
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
    <p className="py-4 text-center text-[11px] text-zinc-600">
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
