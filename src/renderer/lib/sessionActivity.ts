import type { PatternDefinition } from '@shared/domain/pattern';
import type { SessionEventRecord } from '@shared/domain/event';

export interface AgentActivityState {
  agentId: string;
  agentName: string;
  activityType?: SessionEventRecord['activityType'];
  toolName?: string;
}

export interface SessionUsageState {
  tokenLimit: number;
  currentTokens: number;
  messagesLength: number;
}

export type SessionActivityState = Record<string, AgentActivityState>;
export type SessionActivityMap = Record<string, SessionActivityState | undefined>;
export type SessionUsageMap = Record<string, SessionUsageState | undefined>;

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

export function applySessionUsageEvent(
  current: SessionUsageMap,
  event: SessionEventRecord,
): SessionUsageMap {
  if (event.kind !== 'session-usage' || event.tokenLimit === undefined || event.currentTokens === undefined) {
    return current;
  }

  return {
    ...current,
    [event.sessionId]: {
      tokenLimit: event.tokenLimit,
      currentTokens: event.currentTokens,
      messagesLength: event.messagesLength ?? 0,
    },
  };
}

export function pruneSessionUsage(
  current: SessionUsageMap,
  sessionIds: Iterable<string>,
): SessionUsageMap {
  const allowed = new Set(sessionIds);
  const next: SessionUsageMap = {};
  let changed = false;

  for (const [sessionId, usage] of Object.entries(current)) {
    if (!allowed.has(sessionId)) {
      changed = true;
      continue;
    }
    next[sessionId] = usage;
  }

  return changed || Object.keys(next).length !== Object.keys(current).length ? next : current;
}

/* ── Turn-scoped event log ──────────────────────────────── */

const TURN_EVENT_LOG_LIMIT = 50;

export interface TurnEventEntry {
  kind: SessionEventRecord['kind'];
  occurredAt: string;
  label: string;
  detail?: string;
  phase?: 'start' | 'end' | 'complete';
  success?: boolean;
}

export type TurnEventLog = readonly TurnEventEntry[];
export type TurnEventLogMap = Record<string, TurnEventLog | undefined>;

function formatTurnEventEntry(event: SessionEventRecord): TurnEventEntry | undefined {
  switch (event.kind) {
    case 'subagent':
      return {
        kind: event.kind,
        occurredAt: event.occurredAt,
        label: `Sub-agent ${event.subagentEventKind ?? 'update'}: ${event.customAgentDisplayName ?? event.customAgentName ?? 'unknown'}`,
        detail: event.agentName ? `from ${event.agentName}` : undefined,
        phase: event.subagentEventKind === 'started' ? 'start' : event.subagentEventKind === 'completed' ? 'end' : undefined,
        success: event.subagentEventKind === 'completed' ? true : event.subagentEventKind === 'failed' ? false : undefined,
      };
    case 'hook-lifecycle': {
      const phaseLabel = event.hookPhase === 'start' ? 'started' : event.hookPhase === 'end' ? 'completed' : undefined;
      return {
        kind: event.kind,
        occurredAt: event.occurredAt,
        label: phaseLabel ? `Hook ${event.hookType ?? 'unknown'} ${phaseLabel}` : `Hook ${event.hookType ?? 'unknown'}`,
        detail: event.hookInvocationId,
        phase: event.hookPhase,
        success: event.hookSuccess,
      };
    }
    case 'skill-invoked':
      return {
        kind: event.kind,
        occurredAt: event.occurredAt,
        label: `Skill: ${event.skillName ?? 'unknown'}`,
        detail: event.pluginName ? `via ${event.pluginName}` : undefined,
      };
    case 'session-compaction':
      return {
        kind: event.kind,
        occurredAt: event.occurredAt,
        label: event.compactionPhase === 'start' ? 'Context compaction started' : 'Context compaction complete',
        detail: event.compactionPhase === 'complete' && event.tokensRemoved
          ? `${event.tokensRemoved.toLocaleString()} tokens freed`
          : undefined,
        phase: event.compactionPhase,
        success: event.compactionSuccess,
      };
    default:
      return undefined;
  }
}

export function applyTurnEventLog(
  current: TurnEventLogMap,
  event: SessionEventRecord,
): TurnEventLogMap {
  const entry = formatTurnEventEntry(event);
  if (!entry) return current;

  const existing = current[event.sessionId] ?? [];
  const next = [...existing, entry].slice(-TURN_EVENT_LOG_LIMIT);

  return { ...current, [event.sessionId]: next };
}

export function pruneTurnEventLogs(
  current: TurnEventLogMap,
  sessionIds: Iterable<string>,
): TurnEventLogMap {
  const allowed = new Set(sessionIds);
  const next: TurnEventLogMap = {};
  let changed = false;

  for (const [sessionId, log] of Object.entries(current)) {
    if (!allowed.has(sessionId)) {
      changed = true;
      continue;
    }
    next[sessionId] = log;
  }

  return changed || Object.keys(next).length !== Object.keys(current).length ? next : current;
}
