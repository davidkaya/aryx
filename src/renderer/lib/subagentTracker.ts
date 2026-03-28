import type { SessionEventRecord, SubagentEventKind } from '@shared/domain/event';

export interface ActiveSubagent {
  toolCallId: string;
  name: string;
  description?: string;
  model?: string;
  activityLabel: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export type ActiveSubagentMap = Record<string, ReadonlyArray<ActiveSubagent> | undefined>;

function subagentKey(event: SessionEventRecord): string {
  return event.subagentToolCallId ?? event.customAgentName ?? 'unknown';
}

function subagentDisplayName(event: SessionEventRecord): string {
  return event.customAgentDisplayName ?? event.customAgentName ?? 'Sub-agent';
}

function activityLabelForKind(kind: SubagentEventKind | undefined): string {
  switch (kind) {
    case 'started':
      return 'Starting…';
    case 'selected':
      return 'Selected';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'deselected':
      return 'Deselected';
    default:
      return 'Working…';
  }
}

export function applySubagentEvent(
  current: ActiveSubagentMap,
  event: SessionEventRecord,
): ActiveSubagentMap {
  if (event.kind !== 'subagent') {
    // Clear all subagents when session goes idle
    if (event.kind === 'status' && event.status === 'idle') {
      if (!current[event.sessionId]?.length) return current;
      const next = { ...current };
      delete next[event.sessionId];
      return next;
    }

    // Update running subagent activity from agent-activity events
    if (event.kind === 'agent-activity' && event.agentName) {
      const existing = current[event.sessionId];
      if (!existing?.length) return current;

      const agentName = event.agentName.trim();
      const hasMatch = existing.some(
        (s) => s.status === 'running' && s.name === agentName,
      );
      if (!hasMatch) return current;

      let label: string;
      switch (event.activityType) {
        case 'tool-calling':
          label = `Using ${event.toolName?.trim() || 'a tool'}…`;
          break;
        case 'thinking':
          label = 'Thinking…';
          break;
        case 'handoff':
          label = 'Handling handoff…';
          break;
        default:
          return current;
      }

      return {
        ...current,
        [event.sessionId]: existing.map((s) =>
          s.status === 'running' && s.name === agentName
            ? { ...s, activityLabel: label }
            : s,
        ),
      };
    }

    return current;
  }

  const key = subagentKey(event);
  const existing = current[event.sessionId] ?? [];

  switch (event.subagentEventKind) {
    case 'started': {
      const entry: ActiveSubagent = {
        toolCallId: key,
        name: subagentDisplayName(event),
        description: event.customAgentDescription,
        model: event.subagentModel,
        activityLabel: activityLabelForKind('started'),
        startedAt: event.occurredAt,
        status: 'running',
      };
      return {
        ...current,
        [event.sessionId]: [...existing.filter((s) => s.toolCallId !== key), entry],
      };
    }

    case 'completed': {
      return {
        ...current,
        [event.sessionId]: existing.map((s) =>
          s.toolCallId === key
            ? { ...s, status: 'completed' as const, activityLabel: activityLabelForKind('completed') }
            : s,
        ),
      };
    }

    case 'failed': {
      return {
        ...current,
        [event.sessionId]: existing.map((s) =>
          s.toolCallId === key
            ? {
                ...s,
                status: 'failed' as const,
                activityLabel: activityLabelForKind('failed'),
                error: event.subagentError,
              }
            : s,
        ),
      };
    }

    default:
      return current;
  }
}

export function pruneSubagentMap(
  current: ActiveSubagentMap,
  sessionIds: Iterable<string>,
): ActiveSubagentMap {
  const allowed = new Set(sessionIds);
  const next: ActiveSubagentMap = {};
  let changed = false;

  for (const [sessionId, subagents] of Object.entries(current)) {
    if (!allowed.has(sessionId)) {
      changed = true;
      continue;
    }
    next[sessionId] = subagents;
  }

  return changed || Object.keys(next).length !== Object.keys(current).length ? next : current;
}
