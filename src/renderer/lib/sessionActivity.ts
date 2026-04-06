import type { AgentNodeConfig } from '@shared/domain/workflow';
import type { SessionEventRecord } from '@shared/domain/event';
import type { QuotaSnapshot, WorkflowDiagnosticKind, WorkflowDiagnosticSeverity } from '@shared/contracts/sidecar';

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
  agents: ReadonlyArray<{ id: string; name: string }>,
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

const hookTypeLabels: Record<string, string> = {
  sessionStart: 'Session start',
  sessionEnd: 'Session end',
  userPromptSubmitted: 'Prompt submitted',
  preToolUse: 'Pre-tool use',
  postToolUse: 'Post-tool use',
  errorOccurred: 'Error occurred',
};

function formatHookType(hookType: string | undefined): string {
  if (!hookType) return 'Unknown';
  return hookTypeLabels[hookType] ?? hookType;
}

const diagnosticLabels: Record<WorkflowDiagnosticKind, string> = {
  'workflow-warning': 'Workflow warning',
  'workflow-error': 'Workflow error',
  'executor-failed': 'Executor failed',
  'subworkflow-warning': 'Subworkflow warning',
  'subworkflow-error': 'Subworkflow error',
};

function formatDiagnosticLabel(
  kind: WorkflowDiagnosticKind | undefined,
  severity: WorkflowDiagnosticSeverity | undefined,
): string {
  if (kind) return diagnosticLabels[kind] ?? kind;
  return severity === 'error' ? 'Workflow error' : 'Workflow warning';
}

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
      const hookLabel = formatHookType(event.hookType);
      const phaseLabel = event.hookPhase === 'start' ? 'started' : event.hookPhase === 'end' ? 'completed' : undefined;
      return {
        kind: event.kind,
        occurredAt: event.occurredAt,
        label: phaseLabel ? `${hookLabel} hook ${phaseLabel}` : `${hookLabel} hook`,
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
    case 'workflow-diagnostic': {
      const label = formatDiagnosticLabel(event.diagnosticKind, event.diagnosticSeverity);
      const detailParts: string[] = [];
      if (event.executorId) detailParts.push(event.executorId);
      if (event.subworkflowId) detailParts.push(event.subworkflowId);
      if (event.exceptionType) detailParts.push(event.exceptionType);
      if (event.diagnosticMessage) detailParts.push(event.diagnosticMessage);
      return {
        kind: event.kind,
        occurredAt: event.occurredAt,
        label,
        detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        success: event.diagnosticSeverity === 'error' ? false : undefined,
      };
    }
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

/* ── Assistant usage accumulator ────────────────────────────── */

export interface AgentUsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  requestCount: number;
}

export interface SessionRequestUsageState {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalDurationMs: number;
  totalNanoAiu: number;
  requestCount: number;
  perAgent: Record<string, AgentUsageAccumulator>;
  latestQuotaSnapshots?: Record<string, QuotaSnapshot>;
}

export type SessionRequestUsageMap = Record<string, SessionRequestUsageState | undefined>;

function createEmptyUsageAccumulator(): AgentUsageAccumulator {
  return { inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0, requestCount: 0 };
}

export function applyAssistantUsageEvent(
  current: SessionRequestUsageMap,
  event: SessionEventRecord,
): SessionRequestUsageMap {
  if (event.kind !== 'assistant-usage') {
    return current;
  }

  const prev = current[event.sessionId] ?? {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    totalDurationMs: 0,
    totalNanoAiu: 0,
    requestCount: 0,
    perAgent: {},
  };

  const inputTokens = event.usageInputTokens ?? 0;
  const outputTokens = event.usageOutputTokens ?? 0;
  const cost = event.usageCost ?? 0;
  const durationMs = event.usageDuration ?? 0;
  const nanoAiu = event.usageTotalNanoAiu ?? 0;

  const next: SessionRequestUsageState = {
    totalInputTokens: prev.totalInputTokens + inputTokens,
    totalOutputTokens: prev.totalOutputTokens + outputTokens,
    totalCost: prev.totalCost + cost,
    totalDurationMs: prev.totalDurationMs + durationMs,
    totalNanoAiu: nanoAiu > 0 ? nanoAiu : prev.totalNanoAiu,
    requestCount: prev.requestCount + 1,
    perAgent: { ...prev.perAgent },
    latestQuotaSnapshots: event.usageQuotaSnapshots ?? prev.latestQuotaSnapshots,
  };

  const agentKey = event.agentId?.trim() || event.agentName?.trim();
  if (agentKey) {
    const agentPrev = next.perAgent[agentKey] ?? createEmptyUsageAccumulator();
    next.perAgent[agentKey] = {
      inputTokens: agentPrev.inputTokens + inputTokens,
      outputTokens: agentPrev.outputTokens + outputTokens,
      cost: agentPrev.cost + cost,
      durationMs: agentPrev.durationMs + durationMs,
      requestCount: agentPrev.requestCount + 1,
    };
  }

  return { ...current, [event.sessionId]: next };
}

export function pruneSessionRequestUsage(
  current: SessionRequestUsageMap,
  sessionIds: Iterable<string>,
): SessionRequestUsageMap {
  const allowed = new Set(sessionIds);
  const next: SessionRequestUsageMap = {};
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

/* ── Formatting helpers ─────────────────────────────────────── */

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function formatNanoAiu(nanoAiu: number): string {
  const aiu = nanoAiu / 1e9;
  if (aiu >= 100) return aiu.toFixed(0);
  if (aiu >= 10) return aiu.toFixed(1);
  return aiu.toFixed(2);
}

export function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
