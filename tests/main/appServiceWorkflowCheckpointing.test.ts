import { describe, expect, mock, test } from 'bun:test';

import type { RunTurnCommand, WorkflowCheckpointSavedEvent, WorkflowCheckpointResume } from '@shared/contracts/sidecar';
import { SCRATCHPAD_PROJECT_ID } from '@shared/domain/project';
import type { ChatMessageRecord, SessionRecord } from '@shared/domain/session';
import {
  createSessionRunRecord,
  type RunTimelineEventRecord,
  type SessionRunRecord,
} from '@shared/domain/runTimeline';
import type { WorkflowDefinition } from '@shared/domain/workflow';

mock.module('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
      getPath: () => 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures',
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: {
      openPath: async () => '',
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { AryxAppService } = await import('@main/AryxAppService');

describe('AryxAppService workflow checkpointing', () => {
  test('records workflow checkpoint recovery snapshots from turn-scoped events', async () => {
    const service = new AryxAppService();
    const { session, run } = createRunningSession();
    const checkpointEvent: WorkflowCheckpointSavedEvent = {
      type: 'workflow-checkpoint-saved',
      requestId: run.requestId,
      sessionId: session.id,
      workflowSessionId: run.requestId,
      checkpointId: 'checkpoint-1',
      storePath: 'C:\\Users\\tester\\AppData\\Local\\Aryx\\workflow-checkpoints\\session-1\\turn-1',
      stepNumber: 2,
    };

    const internals = service as unknown as {
      workflowCheckpointRecoveries: Map<string, unknown>;
      handleTurnScopedEvent: (
        workspace: { sessions: SessionRecord[] },
        sessionId: string,
        event: WorkflowCheckpointSavedEvent,
      ) => void | Promise<void>;
    };

    await internals.handleTurnScopedEvent({ sessions: [session] }, session.id, checkpointEvent);

    expect(internals.workflowCheckpointRecoveries.get(run.requestId)).toEqual({
      workflowSessionId: run.requestId,
      checkpointId: 'checkpoint-1',
      storePath: checkpointEvent.storePath,
      stepNumber: 2,
      sessionMessages: session.messages,
      runEvents: run.events,
    });
  });

  test('retries a checkpointed turn with resume metadata after sidecar exit', async () => {
    const service = new AryxAppService();
    const { session, run } = createRunningSession();
    const workspace = { sessions: [session] };
    const checkpointRecovery = {
      workflowSessionId: run.requestId,
      checkpointId: 'checkpoint-7',
      storePath: 'C:\\Users\\tester\\AppData\\Local\\Aryx\\workflow-checkpoints\\session-1\\turn-1',
      stepNumber: 7,
      sessionMessages: structuredClone(session.messages),
      runEvents: structuredClone(run.events),
    };
    const invocations: RunTurnCommand[] = [];

    session.messages.push({
      id: 'msg-partial',
      role: 'assistant',
      authorName: 'Primary',
      content: 'Partial output after the checkpoint.',
      createdAt: '2026-04-01T12:00:05.000Z',
      pending: true,
    });
    run.events = [
      ...run.events,
      {
        id: 'run-event-extra',
        kind: 'message',
        occurredAt: '2026-04-01T12:00:05.000Z',
        status: 'running',
        messageId: 'msg-partial',
        content: 'Partial output after the checkpoint.',
      } satisfies RunTimelineEventRecord,
    ];
    session.pendingUserInput = {
      id: 'user-input-1',
      status: 'pending',
      requestedAt: '2026-04-01T12:00:05.000Z',
      question: 'Need more detail?',
      choices: ['Yes', 'No'],
      allowFreeform: true,
    };

    (
      service as unknown as {
        workflowCheckpointRecoveries: Map<string, unknown>;
        sidecar: {
          runTurn: (
            command: RunTurnCommand,
          ) => Promise<ChatMessageRecord[]>;
        };
        persistAndBroadcast: (workspace: unknown) => Promise<void>;
        emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
        runSidecarTurnWithCheckpointRecovery: (
          workspace: unknown,
          session: SessionRecord,
          requestId: string,
          createCommand: (resumeFromCheckpoint?: WorkflowCheckpointResume) => RunTurnCommand,
          onDelta: () => Promise<void>,
          onActivity: () => Promise<void>,
          onApproval: () => Promise<void>,
          onUserInput: () => Promise<void>,
          onMcpOAuthRequired: () => Promise<void>,
          onExitPlanMode: () => Promise<void>,
          onMessageReclassified: () => Promise<void>,
          onTurnScopedEvent: () => Promise<void>,
        ) => Promise<ChatMessageRecord[]>;
      }
    ).workflowCheckpointRecoveries.set(run.requestId, checkpointRecovery);
    (
      service as unknown as {
        sidecar: {
          runTurn: (command: RunTurnCommand) => Promise<ChatMessageRecord[]>;
        };
      }
    ).sidecar = {
      runTurn: async (command: RunTurnCommand) => {
        invocations.push(structuredClone(command));
        if (invocations.length === 1) {
          throw new Error('The .NET sidecar exited unexpectedly with code 1.');
        }

        return [];
      },
    };
    (
      service as unknown as {
        persistAndBroadcast: (workspace: unknown) => Promise<void>;
        emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
      }
    ).persistAndBroadcast = async () => undefined;
    (
      service as unknown as {
        emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
      }
    ).emitRunUpdated = () => undefined;

    const result = await (
      service as unknown as {
        runSidecarTurnWithCheckpointRecovery: (
          workspace: unknown,
          session: SessionRecord,
          requestId: string,
          createCommand: (resumeFromCheckpoint?: WorkflowCheckpointResume) => RunTurnCommand,
          onDelta: () => Promise<void>,
          onActivity: () => Promise<void>,
          onApproval: () => Promise<void>,
          onUserInput: () => Promise<void>,
          onMcpOAuthRequired: () => Promise<void>,
          onExitPlanMode: () => Promise<void>,
          onMessageReclassified: () => Promise<void>,
          onTurnScopedEvent: () => Promise<void>,
        ) => Promise<ChatMessageRecord[]>;
      }
    ).runSidecarTurnWithCheckpointRecovery(
      workspace,
      session,
      run.requestId,
      (resumeFromCheckpoint?: WorkflowCheckpointResume): RunTurnCommand => ({
        type: 'run-turn',
        requestId: run.requestId,
        sessionId: session.id,
        projectPath: 'C:\\scratchpad',
        workspaceKind: 'scratchpad',
        mode: 'interactive',
        messageMode: 'enqueue',
        workflow: createWorkflow(),
        messages: session.messages,
        resumeFromCheckpoint,
      }),
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
    );

    expect(result).toEqual([]);
    expect(invocations).toHaveLength(2);
    expect(invocations[0]?.resumeFromCheckpoint).toBeUndefined();
    expect(invocations[1]?.resumeFromCheckpoint).toEqual({
      workflowSessionId: run.requestId,
      checkpointId: 'checkpoint-7',
      storePath: checkpointRecovery.storePath,
    });
    expect(invocations[1]?.messages).toEqual(checkpointRecovery.sessionMessages);
    expect(session.messages).toEqual(checkpointRecovery.sessionMessages);
    expect(session.pendingUserInput).toBeUndefined();
    expect(session.runs[0]?.events).toEqual(checkpointRecovery.runEvents);
  });
});

function createRunningSession(): { session: SessionRecord; run: SessionRunRecord } {
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
    title: 'Checkpoint session',
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
      {
        id: 'msg-assistant-1',
        role: 'assistant',
        authorName: 'Primary',
        content: 'Working on it.',
        createdAt: '2026-04-01T12:00:01.000Z',
        pending: true,
      },
    ],
    runs: [run],
  };

  return { session, run };
}

function createWorkflow(): WorkflowDefinition {
  return {
    id: 'workflow-handoff',
    name: 'Checkpointing flow',
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
      executionMode: 'off-thread' as const,
      orchestrationMode: 'handoff' as const,
      maxIterations: 4,
    },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}
