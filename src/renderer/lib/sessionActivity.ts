import type { SessionEventRecord } from '@shared/domain/event';

export interface SessionActivityState {
  sessionId: string;
  activityType?: SessionEventRecord['activityType'];
  agentName?: string;
  toolName?: string;
}

export type SessionActivityMap = Record<string, SessionActivityState | undefined>;

export function applySessionEventActivity(
  current: SessionActivityMap,
  event: SessionEventRecord,
): SessionActivityMap {
  if (event.kind === 'agent-activity') {
    return {
      ...current,
      [event.sessionId]: {
        sessionId: event.sessionId,
        activityType: event.activityType,
        agentName: event.agentName,
        toolName: event.toolName,
      },
    };
  }

  if (event.kind === 'status') {
    if (event.status === 'running' || event.status === 'idle' || event.status === 'error') {
      return removeSessionActivity(current, event.sessionId);
    }
  }

  if (event.kind === 'error') {
    return removeSessionActivity(current, event.sessionId);
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

export function formatSessionActivityLabel(
  activity: SessionActivityState | undefined,
  fallbackAgentName = 'Agent',
): string {
  const agentName = activity?.agentName?.trim() || fallbackAgentName;

  switch (activity?.activityType) {
    case 'tool-calling':
      return `${agentName} is using ${activity.toolName?.trim() || 'a tool'}…`;
    case 'handoff':
      return `Handing off to ${agentName}…`;
    case 'completed':
      return `${agentName} completed their turn.`;
    case 'thinking':
    default:
      return `${agentName} is thinking…`;
  }
}

export function shouldAnimateSessionActivity(activity: SessionActivityState | undefined): boolean {
  return activity?.activityType !== 'completed';
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
