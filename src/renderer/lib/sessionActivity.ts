import type { PatternDefinition } from '@shared/domain/pattern';
import type { SessionEventRecord } from '@shared/domain/event';

export interface AgentActivityState {
  agentId: string;
  agentName: string;
  activityType?: SessionEventRecord['activityType'];
  toolName?: string;
}

export type SessionActivityState = Record<string, AgentActivityState>;
export type SessionActivityMap = Record<string, SessionActivityState | undefined>;

export interface AgentActivityRow {
  key: string;
  agentName: string;
  activity?: AgentActivityState;
}

export function applySessionEventActivity(
  current: SessionActivityMap,
  event: SessionEventRecord,
): SessionActivityMap {
  if (event.kind === 'agent-activity') {
    const agentKey = resolveAgentKey(event);
    if (!agentKey) {
      console.warn('[aryx activity] Dropping agent-activity event without agentId/agentName.', event);
      return current;
    }

    return {
      ...current,
      [event.sessionId]: {
        ...(current[event.sessionId] ?? {}),
        [agentKey]: {
          agentId: event.agentId ?? agentKey,
          agentName: event.agentName?.trim() || event.agentId?.trim() || agentKey,
          activityType: event.activityType,
          toolName: event.toolName,
        },
      },
    };
  }

  if (event.kind === 'status') {
    if (event.status === 'running') {
      return removeSessionActivity(current, event.sessionId);
    }

    if (event.status === 'idle') {
      return clearActiveSessionActivity(current, event.sessionId);
    }
  }

  if (
    event.kind === 'run-updated'
    && event.run
    && (event.run.status === 'cancelled' || event.run.status === 'error')
  ) {
    return clearActiveSessionActivity(current, event.sessionId);
  }

  return current;
}

export function pruneSessionActivities(
  current: SessionActivityMap,
  sessionIds: Iterable<string>,
): SessionActivityMap {
  const allowed = new Set(sessionIds);
  const next: SessionActivityMap = {};
  let changed = false;

  for (const [sessionId, activity] of Object.entries(current)) {
    if (!allowed.has(sessionId)) {
      changed = true;
      continue;
    }

    next[sessionId] = activity;
  }

  return changed || Object.keys(next).length !== Object.keys(current).length ? next : current;
}

export function buildAgentActivityRows(
  current: SessionActivityState | undefined,
  agents: PatternDefinition['agents'],
): AgentActivityRow[] {
  return agents.map((agent) => {
    const activity = current?.[agent.id] ?? current?.[agent.name];

    if (activity) {
      return {
        key: agent.id,
        agentName: agent.name,
        activity,
      };
    }

    return {
      key: agent.id,
      agentName: agent.name,
    };
  });
}

export function formatAgentActivityLabel(activity: AgentActivityState | undefined): string {
  if (!activity) {
    return 'No status yet';
  }

  switch (activity?.activityType) {
    case 'tool-calling':
      return `Using ${activity.toolName?.trim() || 'a tool'}…`;
    case 'handoff':
      return 'Handling handoff…';
    case 'completed':
      return 'Completed';
    case 'thinking':
      return 'Thinking…';
    default:
      return 'No status yet';
  }
}

export function isAgentActivityActive(activity: AgentActivityState | undefined): boolean {
  return (
    activity?.activityType === 'thinking'
    || activity?.activityType === 'tool-calling'
    || activity?.activityType === 'handoff'
  );
}

export function isAgentActivityCompleted(activity: AgentActivityState | undefined): boolean {
  return activity?.activityType === 'completed';
}

function removeSessionActivity(
  current: SessionActivityMap,
  sessionId: string,
): SessionActivityMap {
  if (!(sessionId in current)) {
    return current;
  }

  const next = { ...current };
  delete next[sessionId];
  return next;
}

function clearActiveSessionActivity(
  current: SessionActivityMap,
  sessionId: string,
): SessionActivityMap {
  const sessionActivity = current[sessionId];
  if (!sessionActivity) {
    return current;
  }

  let changed = false;
  const nextSessionActivity = Object.fromEntries(
    Object.entries(sessionActivity).filter(([, activity]) => {
      const keep = !isAgentActivityActive(activity);
      changed ||= !keep;
      return keep;
    }),
  );

  if (!changed) {
    return current;
  }

  if (Object.keys(nextSessionActivity).length === 0) {
    return removeSessionActivity(current, sessionId);
  }

  return {
    ...current,
    [sessionId]: nextSessionActivity,
  };
}

function resolveAgentKey(event: SessionEventRecord): string | undefined {
  return event.agentId?.trim() || event.agentName?.trim();
}
