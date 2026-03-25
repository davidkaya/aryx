import type {
  ApprovalCheckpointKind,
  ApprovalDecision,
  PendingApprovalRecord,
} from '@shared/domain/approval';
import type { PatternDefinition, ReasoningEffort } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import { createId } from '@shared/utils/ids';

export type SessionRunStatus = 'running' | 'completed' | 'cancelled' | 'error';
export type SessionRunWorkspaceKind = 'project' | 'scratchpad';
export type RunTimelineEventKind =
  | 'run-started'
  | 'thinking'
  | 'handoff'
  | 'tool-call'
  | 'approval'
  | 'message'
  | 'run-completed'
  | 'run-cancelled'
  | 'run-failed';
export type RunTimelineEventStatus = 'running' | 'completed' | 'error';

export interface RunTimelineAgentRecord {
  agentId: string;
  agentName: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface RunTimelineEventRecord {
  id: string;
  kind: RunTimelineEventKind;
  occurredAt: string;
  updatedAt?: string;
  status: RunTimelineEventStatus;
  agentId?: string;
  agentName?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  targetAgentId?: string;
  targetAgentName?: string;
  toolName?: string;
  approvalId?: string;
  approvalKind?: ApprovalCheckpointKind;
  approvalTitle?: string;
  approvalDetail?: string;
  permissionKind?: string;
  decision?: ApprovalDecision;
  messageId?: string;
  content?: string;
  error?: string;
}

export interface SessionRunRecord {
  id: string;
  requestId: string;
  projectId: string;
  projectPath: string;
  workspaceKind: SessionRunWorkspaceKind;
  patternId: string;
  patternName: string;
  patternMode: PatternDefinition['mode'];
  triggerMessageId: string;
  startedAt: string;
  completedAt?: string;
  status: SessionRunStatus;
  agents: RunTimelineAgentRecord[];
  events: RunTimelineEventRecord[];
}

export interface CreateSessionRunRecordInput {
  requestId: string;
  project: Pick<ProjectRecord, 'id' | 'path'>;
  workspaceKind: SessionRunWorkspaceKind;
  pattern: Pick<PatternDefinition, 'id' | 'name' | 'mode' | 'agents'>;
  triggerMessageId: string;
  startedAt: string;
}

export interface AppendRunActivityEventInput {
  activityType: 'thinking' | 'tool-calling' | 'handoff';
  occurredAt: string;
  agentId?: string;
  agentName?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  toolName?: string;
}

export interface UpsertRunMessageEventInput {
  messageId: string;
  occurredAt: string;
  authorName?: string;
  content?: string;
  status: RunTimelineEventStatus;
  error?: string;
}

function approvalStatusToRunStatus(status: PendingApprovalRecord['status']): RunTimelineEventStatus {
  switch (status) {
    case 'approved':
      return 'completed';
    case 'rejected':
      return 'error';
    default:
      return 'running';
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRunTimelineAgent(
  agent: RunTimelineAgentRecord,
): RunTimelineAgentRecord | undefined {
  const agentId = normalizeOptionalString(agent.agentId);
  const agentName = normalizeOptionalString(agent.agentName);
  const model = normalizeOptionalString(agent.model);
  if (!agentId || !agentName || !model) {
    return undefined;
  }

  return {
    agentId,
    agentName,
    model,
    reasoningEffort: agent.reasoningEffort,
  };
}

function normalizeRunTimelineEvent(
  event: RunTimelineEventRecord,
): RunTimelineEventRecord | undefined {
  const id = normalizeOptionalString(event.id);
  const occurredAt = normalizeOptionalString(event.occurredAt);
  if (!id || !occurredAt) {
    return undefined;
  }

  return {
    id,
    kind: event.kind,
    occurredAt,
    updatedAt: normalizeOptionalString(event.updatedAt),
    status: event.status,
    agentId: normalizeOptionalString(event.agentId),
    agentName: normalizeOptionalString(event.agentName),
    sourceAgentId: normalizeOptionalString(event.sourceAgentId),
    sourceAgentName: normalizeOptionalString(event.sourceAgentName),
    targetAgentId: normalizeOptionalString(event.targetAgentId),
    targetAgentName: normalizeOptionalString(event.targetAgentName),
    toolName: normalizeOptionalString(event.toolName),
    approvalId: normalizeOptionalString(event.approvalId),
    approvalKind: event.approvalKind,
    approvalTitle: normalizeOptionalString(event.approvalTitle),
    approvalDetail: normalizeOptionalString(event.approvalDetail),
    permissionKind: normalizeOptionalString(event.permissionKind),
    decision: event.decision,
    messageId: normalizeOptionalString(event.messageId),
    content: event.content,
    error: normalizeOptionalString(event.error),
  };
}

function resolveRunTimelineAgent(
  run: SessionRunRecord,
  agentId?: string,
  agentName?: string,
): Pick<RunTimelineEventRecord, 'agentId' | 'agentName'> {
  const normalizedAgentId = normalizeOptionalString(agentId);
  const normalizedAgentName = normalizeOptionalString(agentName);

  if (normalizedAgentId) {
    const matchedAgent = run.agents.find((agent) => agent.agentId === normalizedAgentId);
    if (matchedAgent) {
      return {
        agentId: matchedAgent.agentId,
        agentName: matchedAgent.agentName,
      };
    }
  }

  if (normalizedAgentName) {
    const matchedAgent = run.agents.find((agent) => agent.agentName === normalizedAgentName);
    if (matchedAgent) {
      return {
        agentId: matchedAgent.agentId,
        agentName: matchedAgent.agentName,
      };
    }
  }

  return {
    agentId: normalizedAgentId,
    agentName: normalizedAgentName,
  };
}

function appendRunTimelineEvent(
  run: SessionRunRecord,
  event: Omit<RunTimelineEventRecord, 'id'> & { id?: string },
): SessionRunRecord {
  const nextEvent = normalizeRunTimelineEvent({
    id: event.id ?? createId('run-event'),
    ...event,
  });
  if (!nextEvent) {
    return run;
  }

  return {
    ...run,
    events: [...run.events, nextEvent],
  };
}

function settleOpenMessageEvents(
  run: SessionRunRecord,
  status: Extract<RunTimelineEventStatus, 'completed' | 'error'>,
  occurredAt: string,
  error?: string,
): SessionRunRecord {
  let changed = false;
  const normalizedError = normalizeOptionalString(error);
  const nextEvents = run.events.map((event) => {
    if (event.kind !== 'message' || event.status !== 'running') {
      return event;
    }

    changed = true;
    return {
      ...event,
      status,
      updatedAt: occurredAt,
      error: normalizedError,
    };
  });

  if (!changed) {
    return run;
  }

  return {
    ...run,
    events: nextEvents,
  };
}

export function createSessionRunRecord(input: CreateSessionRunRecordInput): SessionRunRecord {
  return {
    id: createId('run'),
    requestId: input.requestId,
    projectId: input.project.id,
    projectPath: input.project.path,
    workspaceKind: input.workspaceKind,
    patternId: input.pattern.id,
    patternName: input.pattern.name,
    patternMode: input.pattern.mode,
    triggerMessageId: input.triggerMessageId,
    startedAt: input.startedAt,
    status: 'running',
    completedAt: undefined,
    agents: input.pattern.agents
      .map((agent): RunTimelineAgentRecord => ({
        agentId: agent.id,
        agentName: agent.name,
        model: agent.model,
        reasoningEffort: agent.reasoningEffort,
      }))
      .flatMap((agent) => {
        const normalized = normalizeRunTimelineAgent(agent);
        return normalized ? [normalized] : [];
      }),
    events: [
      {
        id: createId('run-event'),
        kind: 'run-started',
        occurredAt: input.startedAt,
        status: 'completed',
        messageId: input.triggerMessageId,
      },
    ],
  };
}

export function normalizeSessionRunRecords(
  runs: readonly SessionRunRecord[] | undefined,
): SessionRunRecord[] {
  if (!runs || runs.length === 0) {
    return [];
  }

  return runs.flatMap((run) => {
    const id = normalizeOptionalString(run.id);
    const requestId = normalizeOptionalString(run.requestId);
    const projectId = normalizeOptionalString(run.projectId);
    const projectPath = normalizeOptionalString(run.projectPath);
    const patternId = normalizeOptionalString(run.patternId);
    const patternName = normalizeOptionalString(run.patternName);
    const triggerMessageId = normalizeOptionalString(run.triggerMessageId);
    const startedAt = normalizeOptionalString(run.startedAt);
    if (!id || !requestId || !projectId || !projectPath || !patternId || !patternName || !triggerMessageId || !startedAt) {
      return [];
    }

    return [
      {
        id,
        requestId,
        projectId,
        projectPath,
        workspaceKind: run.workspaceKind === 'scratchpad' ? 'scratchpad' : 'project',
        patternId,
        patternName,
        patternMode: run.patternMode,
        triggerMessageId,
        startedAt,
        completedAt: normalizeOptionalString(run.completedAt),
        status: run.status === 'error' ? 'error' : run.status === 'running' ? 'running' : run.status === 'cancelled' ? 'cancelled' : 'completed',
        agents: run.agents.flatMap((agent) => {
          const normalized = normalizeRunTimelineAgent(agent);
          return normalized ? [normalized] : [];
        }),
        events: run.events.flatMap((event) => {
          const normalized = normalizeRunTimelineEvent(event);
          return normalized ? [normalized] : [];
        }),
      },
    ];
  });
}

export function upsertSessionRunRecord(
  runs: readonly SessionRunRecord[],
  nextRun: SessionRunRecord,
): SessionRunRecord[] {
  const runIndex = runs.findIndex((run) => run.id === nextRun.id);
  if (runIndex < 0) {
    return [nextRun, ...runs];
  }

  const nextRuns = runs.slice();
  nextRuns[runIndex] = nextRun;
  return nextRuns;
}

export function upsertRunApprovalEvent(
  run: SessionRunRecord,
  approval: PendingApprovalRecord,
): SessionRunRecord {
  const existingIndex = run.events.findIndex(
    (event) => event.kind === 'approval' && event.approvalId === approval.id,
  );
  const nextStatus = approvalStatusToRunStatus(approval.status);
  const nextEvent: RunTimelineEventRecord = {
    id: existingIndex >= 0 ? run.events[existingIndex].id : createId('run-event'),
    kind: 'approval',
    occurredAt:
      existingIndex >= 0 ? run.events[existingIndex].occurredAt : approval.requestedAt,
    updatedAt: approval.status === 'pending' ? undefined : approval.resolvedAt,
    status: nextStatus,
    agentId: normalizeOptionalString(approval.agentId),
    agentName: normalizeOptionalString(approval.agentName),
    toolName: normalizeOptionalString(approval.toolName),
    approvalId: approval.id,
    approvalKind: approval.kind,
    approvalTitle: approval.title,
    approvalDetail: normalizeOptionalString(approval.detail),
    permissionKind: normalizeOptionalString(approval.permissionKind),
    decision: approval.status === 'pending' ? undefined : approval.status,
  };

  if (existingIndex < 0) {
    return appendRunTimelineEvent(run, nextEvent);
  }

  const existingEvent = run.events[existingIndex];
  if (
    existingEvent.updatedAt === nextEvent.updatedAt
    && existingEvent.status === nextEvent.status
    && existingEvent.agentId === nextEvent.agentId
    && existingEvent.agentName === nextEvent.agentName
    && existingEvent.toolName === nextEvent.toolName
    && existingEvent.approvalKind === nextEvent.approvalKind
    && existingEvent.approvalTitle === nextEvent.approvalTitle
    && existingEvent.approvalDetail === nextEvent.approvalDetail
    && existingEvent.permissionKind === nextEvent.permissionKind
    && existingEvent.decision === nextEvent.decision
  ) {
    return run;
  }

  const nextEvents = run.events.slice();
  nextEvents[existingIndex] = nextEvent;
  return {
    ...run,
    events: nextEvents,
  };
}

export function appendRunActivityEvent(
  run: SessionRunRecord,
  input: AppendRunActivityEventInput,
): SessionRunRecord {
  switch (input.activityType) {
    case 'thinking': {
      const agent = resolveRunTimelineAgent(run, input.agentId, input.agentName);
      return appendRunTimelineEvent(run, {
        kind: 'thinking',
        occurredAt: input.occurredAt,
        status: 'completed',
        ...agent,
      });
    }
    case 'tool-calling': {
      const agent = resolveRunTimelineAgent(run, input.agentId, input.agentName);
      return appendRunTimelineEvent(run, {
        kind: 'tool-call',
        occurredAt: input.occurredAt,
        status: 'completed',
        ...agent,
        toolName: normalizeOptionalString(input.toolName),
      });
    }
    case 'handoff': {
      const sourceAgent = resolveRunTimelineAgent(run, input.sourceAgentId, input.sourceAgentName);
      const targetAgent = resolveRunTimelineAgent(run, input.agentId, input.agentName);
      return appendRunTimelineEvent(run, {
        kind: 'handoff',
        occurredAt: input.occurredAt,
        status: 'completed',
        agentId: sourceAgent.agentId,
        agentName: sourceAgent.agentName,
        sourceAgentId: sourceAgent.agentId,
        sourceAgentName: sourceAgent.agentName,
        targetAgentId: targetAgent.agentId,
        targetAgentName: targetAgent.agentName,
      });
    }
  }
}

export function upsertRunMessageEvent(
  run: SessionRunRecord,
  input: UpsertRunMessageEventInput,
): SessionRunRecord {
  const messageId = normalizeOptionalString(input.messageId);
  if (!messageId) {
    return run;
  }

  const author = resolveRunTimelineAgent(run, undefined, input.authorName);
  const existingIndex = run.events.findIndex((event) => event.kind === 'message' && event.messageId === messageId);
  const normalizedError = normalizeOptionalString(input.error);

  if (existingIndex < 0) {
    return appendRunTimelineEvent(run, {
      kind: 'message',
      occurredAt: input.occurredAt,
      updatedAt: input.occurredAt,
      status: input.status,
      messageId,
      content: input.content,
      error: normalizedError,
      ...author,
    });
  }

  const existingEvent = run.events[existingIndex];
  const nextEvent: RunTimelineEventRecord = {
    ...existingEvent,
    agentId: existingEvent.agentId ?? author.agentId,
    agentName: existingEvent.agentName ?? author.agentName,
    updatedAt: input.occurredAt,
    status: input.status,
    content: input.content ?? existingEvent.content,
    error: normalizedError,
  };

  if (
    nextEvent.agentId === existingEvent.agentId
    && nextEvent.agentName === existingEvent.agentName
    && nextEvent.updatedAt === existingEvent.updatedAt
    && nextEvent.status === existingEvent.status
    && nextEvent.content === existingEvent.content
    && nextEvent.error === existingEvent.error
  ) {
    return run;
  }

  const nextEvents = run.events.slice();
  nextEvents[existingIndex] = nextEvent;
  return {
    ...run,
    events: nextEvents,
  };
}

export function completeSessionRunRecord(
  run: SessionRunRecord,
  completedAt: string,
): SessionRunRecord {
  const settledRun = settleOpenMessageEvents(run, 'completed', completedAt);
  const completedRun: SessionRunRecord = {
    ...settledRun,
    status: 'completed',
    completedAt,
  };

  return appendRunTimelineEvent(completedRun, {
    kind: 'run-completed',
    occurredAt: completedAt,
    status: 'completed',
  });
}

export function cancelSessionRunRecord(
  run: SessionRunRecord,
  cancelledAt: string,
): SessionRunRecord {
  const settledRun = settleOpenMessageEvents(run, 'completed', cancelledAt);
  const cancelledRun: SessionRunRecord = {
    ...settledRun,
    status: 'cancelled',
    completedAt: cancelledAt,
  };

  return appendRunTimelineEvent(cancelledRun, {
    kind: 'run-cancelled',
    occurredAt: cancelledAt,
    status: 'completed',
  });
}

export function failSessionRunRecord(
  run: SessionRunRecord,
  failedAt: string,
  error: string,
): SessionRunRecord {
  const settledRun = settleOpenMessageEvents(run, 'error', failedAt, error);
  const failedRun: SessionRunRecord = {
    ...settledRun,
    status: 'error',
    completedAt: failedAt,
  };

  return appendRunTimelineEvent(failedRun, {
    kind: 'run-failed',
    occurredAt: failedAt,
    status: 'error',
    error,
  });
}
