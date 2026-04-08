import type {
  RunTimelineEventKind,
  RunTimelineEventRecord,
  SessionRunRecord,
  SessionRunStatus,
} from '@shared/domain/runTimeline';
import { buildMarkdownExcerpt } from '@shared/utils/markdownText';
import { formatToolCallPrimaryLabel } from '@renderer/lib/toolCallSummary';

export function formatRunTimestamp(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function formatRunDuration(startedAt: string, completedAt?: string): string | undefined {
  if (!completedAt) {
    return undefined;
  }

  try {
    const start = new Date(startedAt).getTime();
    const end = new Date(completedAt).getTime();
    const diffMs = end - start;
    if (diffMs < 0 || !Number.isFinite(diffMs)) {
      return undefined;
    }

    if (diffMs < 1000) {
      return `${diffMs}ms`;
    }

    const seconds = Math.round(diffMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  } catch {
    return undefined;
  }
}

export function formatRunStatusLabel(status: SessionRunStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return 'Failed';
  }
}

export function formatEventLabel(event: RunTimelineEventRecord): string {
  switch (event.kind) {
    case 'run-started':
      return 'Run started';
    case 'thinking':
      return event.agentName ? `${event.agentName} thinking` : 'Thinking';
    case 'handoff':
      if (event.sourceAgentName && event.targetAgentName) {
        return `${event.sourceAgentName} → ${event.targetAgentName}`;
      }
      return event.targetAgentName ? `Handoff to ${event.targetAgentName}` : 'Handoff';
    case 'tool-call':
      return formatToolCallPrimaryLabel(event.toolName, event.toolArguments);
    case 'approval':
      if (event.status === 'completed') {
        return event.approvalTitle ? `${event.approvalTitle} approved` : 'Approval granted';
      }
      if (event.status === 'error') {
        return event.approvalTitle ? `${event.approvalTitle} rejected` : 'Approval rejected';
      }
      return event.approvalTitle ?? 'Approval requested';
    case 'message':
      return event.agentName ?? 'Response';
    case 'run-completed':
      return 'Completed';
    case 'run-cancelled':
      return 'Cancelled';
    case 'run-failed':
      return 'Failed';
  }
}

export type CollapsedTimelineEvent =
  | { type: 'single'; event: RunTimelineEventRecord }
  | { type: 'thinking-group'; events: RunTimelineEventRecord[]; agentName: string };

export function collapseTimelineEvents(events: readonly RunTimelineEventRecord[]): CollapsedTimelineEvent[] {
  const result: CollapsedTimelineEvent[] = [];
  let pendingThinking: RunTimelineEventRecord[] = [];
  let pendingThinkingAgent = '';

  function flushThinking() {
    if (pendingThinking.length === 0) return;
    if (pendingThinking.length === 1) {
      result.push({ type: 'single', event: pendingThinking[0] });
    } else {
      result.push({ type: 'thinking-group', events: pendingThinking, agentName: pendingThinkingAgent });
    }
    pendingThinking = [];
    pendingThinkingAgent = '';
  }

  for (const event of events) {
    if (event.kind === 'thinking') {
      const agent = event.agentName ?? '';
      if (pendingThinking.length > 0 && agent === pendingThinkingAgent) {
        pendingThinking.push(event);
      } else {
        flushThinking();
        pendingThinking = [event];
        pendingThinkingAgent = agent;
      }
    } else {
      flushThinking();
      result.push({ type: 'single', event });
    }
  }

  flushThinking();
  return result;
}

const eventKindOrder: Record<RunTimelineEventKind, number> = {
  'run-started': 0,
  'thinking': 1,
  'handoff': 2,
  'tool-call': 3,
  'approval': 4,
  'message': 5,
  'run-completed': 6,
  'run-cancelled': 6,
  'run-failed': 6,
};

export function isTerminalEvent(kind: RunTimelineEventKind): boolean {
  return kind === 'run-completed' || kind === 'run-cancelled' || kind === 'run-failed' || kind === 'run-started';
}

export function eventSortKey(event: RunTimelineEventRecord): number {
  return eventKindOrder[event.kind] ?? 4;
}

export function truncateContent(content: string | undefined, maxLength = 80): string | undefined {
  if (!content) return undefined;
  return buildMarkdownExcerpt(content, maxLength);
}

export function findLatestRun(runs: readonly SessionRunRecord[]): SessionRunRecord | undefined {
  return runs.length > 0 ? runs[0] : undefined;
}

/* ── Agent-scoped event filtering ──────────────────────────── */

/** Run-level events that are not scoped to any specific agent. */
const RUN_LEVEL_EVENT_KINDS = new Set<RunTimelineEventKind>([
  'run-started',
  'run-completed',
  'run-cancelled',
  'run-failed',
]);

/**
 * Filter run events to only those belonging to the given agents.
 * When `agentNames` is undefined or empty (single-agent run), all events pass through.
 * Run-level events (start/complete/fail) are excluded from agent-scoped panels
 * because they represent the entire run, not a specific agent's work.
 */
export function filterEventsByAgent(
  events: readonly RunTimelineEventRecord[],
  agentNames: ReadonlySet<string> | undefined,
): RunTimelineEventRecord[] {
  if (!agentNames || agentNames.size === 0) return events.slice();

  return events.filter((e) => {
    if (RUN_LEVEL_EVENT_KINDS.has(e.kind)) return false;
    if (e.kind === 'handoff') {
      return (e.sourceAgentName != null && agentNames.has(e.sourceAgentName))
        || (e.targetAgentName != null && agentNames.has(e.targetAgentName));
    }
    if (e.agentName) return agentNames.has(e.agentName);
    return false;
  });
}

/** Counts of different activity types within a set of run timeline events. */
export interface ActivitySummary {
  thinkingSteps: number;
  toolCalls: number;
  handoffs: number;
  approvals: number;
  hasError: boolean;
}

/**
 * Summarize activity from thinking messages and (already-filtered) run events.
 */
export function summarizeActivity(
  thinkingMessages: ReadonlyArray<{ content: string }>,
  events: readonly RunTimelineEventRecord[],
): ActivitySummary {
  const thinkingSteps = thinkingMessages.filter((m) => m.content).length;
  let toolCalls = 0;
  let handoffs = 0;
  let approvals = 0;
  let hasError = false;

  for (const e of events) {
    if (e.kind === 'tool-call') toolCalls++;
    else if (e.kind === 'handoff') handoffs++;
    else if (e.kind === 'approval') approvals++;
    else if (e.kind === 'run-failed') hasError = true;
  }

  return { thinkingSteps, toolCalls, handoffs, approvals, hasError };
}
