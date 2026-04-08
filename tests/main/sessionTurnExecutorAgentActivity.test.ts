import { describe, expect, test } from 'bun:test';

import type { AgentActivityEvent } from '@shared/contracts/sidecar';
import type { SessionEventRecord } from '@shared/domain/event';
import { SCRATCHPAD_PROJECT_ID } from '@shared/domain/project';
import {
  createSessionRunRecord,
  type SessionRunRecord,
} from '@shared/domain/runTimeline';
import type { SessionRecord } from '@shared/domain/session';
import type { WorkflowDefinition } from '@shared/domain/workflow';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

import { SessionTurnExecutor } from '@main/services/sessionTurnExecutor';

describe('SessionTurnExecutor agent activity', () => {
  test('preserves subworkflow context on nested agent activity session events', async () => {
    const { workspace, session, run } = createRunningContext();
    const harness = createExecutor();
    const { executor, emittedEvents, runUpdates } = harness;
    const initialEventCount = run.events.length;
    const activityEvent: AgentActivityEvent = {
      type: 'agent-activity',
      requestId: run.requestId,
      sessionId: session.id,
      activityType: 'thinking',
      agentId: 'agent-1',
      agentName: 'Primary',
      subworkflowNodeId: 'nested-flow',
      subworkflowName: 'Nested flow',
    };

    await (
      executor as unknown as {
        applyAgentActivity: (
          workspace: WorkspaceState,
          sessionId: string,
          requestId: string,
          event: AgentActivityEvent,
        ) => Promise<void>;
      }
    ).applyAgentActivity(workspace, session.id, run.requestId, activityEvent);

    expect(harness.saveCalls).toBe(1);
    expect(runUpdates).toHaveLength(1);
    expect(session.runs[0]?.events).toHaveLength(initialEventCount + 1);
    expect(session.runs[0]?.events.at(-1)).toMatchObject({
      kind: 'thinking',
      agentId: 'agent-1',
      agentName: 'Primary',
      status: 'completed',
    });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toMatchObject({
      sessionId: session.id,
      kind: 'agent-activity',
      activityType: 'thinking',
      agentId: 'agent-1',
      agentName: 'Primary',
      subworkflowNodeId: 'nested-flow',
      subworkflowName: 'Nested flow',
    });
  });

  test('emits subworkflow lifecycle events without appending run timeline activity', async () => {
    const { workspace, session, run } = createRunningContext();
    const harness = createExecutor();
    const { executor, emittedEvents, runUpdates } = harness;
    const initialEventCount = run.events.length;
    const activityEvent: AgentActivityEvent = {
      type: 'agent-activity',
      requestId: run.requestId,
      sessionId: session.id,
      activityType: 'subworkflow-started',
      subworkflowNodeId: 'nested-flow',
      subworkflowName: 'Nested flow',
    };

    await (
      executor as unknown as {
        applyAgentActivity: (
          workspace: WorkspaceState,
          sessionId: string,
          requestId: string,
          event: AgentActivityEvent,
        ) => Promise<void>;
      }
    ).applyAgentActivity(workspace, session.id, run.requestId, activityEvent);

    expect(harness.saveCalls).toBe(0);
    expect(runUpdates).toHaveLength(0);
    expect(session.runs[0]?.events).toHaveLength(initialEventCount);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toMatchObject({
      sessionId: session.id,
      kind: 'agent-activity',
      activityType: 'subworkflow-started',
      subworkflowNodeId: 'nested-flow',
      subworkflowName: 'Nested flow',
    });
  });
});

function createExecutor(): {
  executor: SessionTurnExecutor;
  emittedEvents: SessionEventRecord[];
  runUpdates: SessionRunRecord[];
  saveCalls: number;
} {
  const emittedEvents: SessionEventRecord[] = [];
  const runUpdates: SessionRunRecord[] = [];
  let saveCalls = 0;

  const executor = new SessionTurnExecutor({
    saveWorkspace: async () => {
      saveCalls += 1;
    },
    persistWorkspace: async (workspace) => workspace,
    requireSession: (workspace, sessionId) => {
      const session = workspace.sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        throw new Error(`Missing session ${sessionId}`);
      }

      return session;
    },
    resolveSessionWorkflow: () => createWorkflow(),
    updateSessionRun: (session, requestId, updater) => {
      const runIndex = session.runs.findIndex((candidate) => candidate.requestId === requestId);
      if (runIndex < 0) {
        return undefined;
      }

      const nextRun = updater(session.runs[runIndex]!);
      session.runs[runIndex] = nextRun;
      return nextRun;
    },
    emitRunUpdated: (_sessionId, _occurredAt, run) => {
      runUpdates.push(run);
    },
    emitSessionEvent: (event) => {
      emittedEvents.push(event);
    },
    rejectPendingApprovals: () => [],
    buildRunTurnToolingConfig: () => undefined,
    runSidecarTurnWithCheckpointRecovery: async () => [],
    handleApprovalRequested: async () => undefined,
    handleUserInputRequested: async () => undefined,
    handleMcpOAuthRequired: async () => undefined,
    handleExitPlanModeRequested: async () => undefined,
    handleTurnScopedEvent: async () => undefined,
    sidecarResolveApproval: async () => undefined,
    sidecarResolveUserInput: async () => undefined,
    captureWorkingTreeSnapshot: async () => undefined,
    captureWorkingTreeBaseline: async () => [],
    refreshSessionRunGitSummary: async () => undefined,
    cleanupWorkflowCheckpointRecovery: async () => undefined,
    scheduleProjectGitRefresh: () => undefined,
    loadAvailableModelCatalog: async () => [],
  });

  return {
    executor,
    emittedEvents,
    runUpdates,
    get saveCalls() {
      return saveCalls;
    },
  };
}

function createRunningContext(): {
  workspace: WorkspaceState;
  session: SessionRecord;
  run: SessionRunRecord;
} {
  const workflow = createWorkflow();
  const run = createSessionRunRecord({
    requestId: 'turn-1',
    project: {
      id: SCRATCHPAD_PROJECT_ID,
      path: 'C:\\scratchpad',
    },
    workingDirectory: 'C:\\scratchpad',
    workspaceKind: 'scratchpad',
    workflow,
    triggerMessageId: 'msg-user-1',
    startedAt: '2026-04-01T12:00:00.000Z',
  });
  const session: SessionRecord = {
    id: 'session-1',
    projectId: SCRATCHPAD_PROJECT_ID,
    workflowId: workflow.id,
    title: 'Activity session',
    createdAt: '2026-04-01T12:00:00.000Z',
    updatedAt: '2026-04-01T12:00:00.000Z',
    status: 'running',
    messages: [
      {
        id: 'msg-user-1',
        role: 'user',
        authorName: 'You',
        content: 'Continue the workflow.',
        createdAt: '2026-04-01T12:00:00.000Z',
      },
    ],
    runs: [run],
  };
  const workspace = createWorkspaceSeed();
  workspace.sessions = [session];
  workspace.workflows = [workflow];

  return { workspace, session, run };
}

function createWorkflow(): WorkflowDefinition {
  return {
    id: 'workflow-handoff',
    name: 'Activity flow',
    description: '',
    graph: {
      nodes: [
        { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
        {
          id: 'agent-1',
          kind: 'agent',
          label: 'Primary',
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: 'agent-1',
            name: 'Primary',
            description: '',
            instructions: 'Help with the request.',
            model: 'gpt-5.4',
          },
        },
        { id: 'end', kind: 'end', label: 'End', position: { x: 400, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: 'edge-start-agent', source: 'start', target: 'agent-1', kind: 'direct' },
        { id: 'edge-agent-end', source: 'agent-1', target: 'end', kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: true },
      executionMode: 'off-thread',
      orchestrationMode: 'handoff',
      maxIterations: 4,
    },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}
