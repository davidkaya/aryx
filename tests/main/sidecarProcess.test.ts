import { EventEmitter } from 'node:events';

import { describe, expect, mock, test } from 'bun:test';

import type {
  RunTurnCommand,
  SidecarCapabilities,
  WorkflowCheckpointSavedEvent,
  WorkflowDiagnosticEvent,
} from '@shared/contracts/sidecar';

class FakeReadableStream extends EventEmitter {
  setEncoding(_encoding: BufferEncoding): void {}
}

class FakeWritableStream {
  readonly writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new FakeReadableStream();
  readonly stderr = new FakeReadableStream();
  readonly stdin = new FakeWritableStream();
  exitCode: number | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitStdout(line: string): void {
    this.stdout.emit('data', line);
  }

  completeExit(code = 0): void {
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

const spawnedProcesses: FakeChildProcess[] = [];

mock.module('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

mock.module('node:child_process', () => ({
  spawn: () => {
    const child = new FakeChildProcess();
    spawnedProcesses.push(child);
    return child;
  },
}));

const { SidecarClient } = await import('@main/sidecar/sidecarProcess');

const CAPABILITIES_FIXTURE: SidecarCapabilities = {
  runtime: 'dotnet-maf',
  modes: {
    single: { available: true },
    sequential: { available: true },
    concurrent: { available: true },
    handoff: { available: true },
    magentic: { available: true },
    'group-chat': { available: true },
  },
  models: [],
  runtimeTools: [],
  connection: {
    status: 'ready',
    summary: 'Connected',
    checkedAt: '2026-03-25T00:00:00.000Z',
  },
};

function getRequestId(process: FakeChildProcess): string {
  const rawRequest = process.stdin.writes.at(-1);
  if (!rawRequest) {
    throw new Error('Expected the fake sidecar to receive a request.');
  }

  return (JSON.parse(rawRequest.trim()) as { requestId: string }).requestId;
}

describe('SidecarClient', () => {
  test('waits for the disposed sidecar to fully close before spawning a replacement process', async () => {
    spawnedProcesses.length = 0;
    const client = new SidecarClient();

    const firstCapabilities = client.describeCapabilities();
    await Promise.resolve();
    expect(spawnedProcesses).toHaveLength(1);
    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'capabilities',
        requestId: getRequestId(spawnedProcesses[0]!),
        capabilities: CAPABILITIES_FIXTURE,
      })}\n`,
    );
    await expect(firstCapabilities).resolves.toEqual(CAPABILITIES_FIXTURE);

    let disposeCompleted = false;
    const disposePromise = client.dispose().then(() => {
      disposeCompleted = true;
    });

    const replacementCapabilities = client.describeCapabilities();

    await Promise.resolve();

    expect(disposeCompleted).toBe(false);
    expect(spawnedProcesses).toHaveLength(1);

    spawnedProcesses[0]!.completeExit();
    await disposePromise;

    expect(disposeCompleted).toBe(true);
    expect(spawnedProcesses).toHaveLength(2);

    spawnedProcesses[1]!.emitStdout(
      `${JSON.stringify({
        type: 'capabilities',
        requestId: getRequestId(spawnedProcesses[1]!),
        capabilities: CAPABILITIES_FIXTURE,
      })}\n`,
    );
    await expect(replacementCapabilities).resolves.toEqual(CAPABILITIES_FIXTURE);

    const finalDispose = client.dispose();
    spawnedProcesses[1]!.completeExit();
    await finalDispose;
  });

  test('routes workflow diagnostic events through the turn-scoped callback', async () => {
    spawnedProcesses.length = 0;
    const client = new SidecarClient();
    const diagnostics: WorkflowDiagnosticEvent[] = [];
    const command: RunTurnCommand = {
      type: 'run-turn',
      requestId: 'turn-1',
      sessionId: 'session-1',
      projectPath: 'C:\\workspace\\project',
      workflow: {
        id: 'workflow-1',
        name: 'Single Agent',
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
          checkpointing: { enabled: false },
          executionMode: 'off-thread',
          orchestrationMode: 'single',
          maxIterations: 1,
        },
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
      messages: [],
    };

    const turn = client.runTurn(
      command,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async (event) => {
        if (event.type === 'workflow-diagnostic') {
          diagnostics.push(event);
        }
      },
    );

    await Promise.resolve();
    expect(spawnedProcesses).toHaveLength(1);

    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'workflow-diagnostic',
        requestId: command.requestId,
        sessionId: command.sessionId,
        severity: 'error',
        diagnosticKind: 'executor-failed',
        message: 'Tool crashed.',
        agentId: 'agent-1',
        agentName: 'Primary',
        executorId: 'agent-1',
        exceptionType: 'InvalidOperationException',
      } satisfies WorkflowDiagnosticEvent)}\n`,
    );
    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'turn-complete',
        requestId: command.requestId,
        sessionId: command.sessionId,
        messages: [],
        cancelled: false,
      })}\n`,
    );
    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'command-complete',
        requestId: command.requestId,
      })}\n`,
    );

    await expect(turn).resolves.toEqual([]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        type: 'workflow-diagnostic',
        severity: 'error',
        diagnosticKind: 'executor-failed',
        message: 'Tool crashed.',
        executorId: 'agent-1',
      }),
    ]);

    const dispose = client.dispose();
    spawnedProcesses[0]!.completeExit();
    await dispose;
  });

  test('routes workflow checkpoint events through the turn-scoped callback', async () => {
    spawnedProcesses.length = 0;
    const client = new SidecarClient();
    const checkpoints: WorkflowCheckpointSavedEvent[] = [];
    const command: RunTurnCommand = {
      type: 'run-turn',
      requestId: 'turn-1',
      sessionId: 'session-1',
      projectPath: 'C:\\workspace\\project',
      workflow: {
        id: 'workflow-1',
        name: 'Handoff',
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
          maxIterations: 1,
        },
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
      messages: [],
    };

    const turn = client.runTurn(
      command,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async () => undefined,
      async (event) => {
        if (event.type === 'workflow-checkpoint-saved') {
          checkpoints.push(event);
        }
      },
    );

    await Promise.resolve();
    expect(spawnedProcesses).toHaveLength(1);

    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'workflow-checkpoint-saved',
        requestId: command.requestId,
        sessionId: command.sessionId,
        workflowSessionId: 'turn-1',
        checkpointId: 'checkpoint-1',
        storePath: 'C:\\Users\\tester\\AppData\\Local\\Aryx\\workflow-checkpoints\\session-1\\turn-1',
        stepNumber: 2,
      } satisfies WorkflowCheckpointSavedEvent)}\n`,
    );
    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'turn-complete',
        requestId: command.requestId,
        sessionId: command.sessionId,
        messages: [],
        cancelled: false,
      })}\n`,
    );
    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'command-complete',
        requestId: command.requestId,
      })}\n`,
    );

    await expect(turn).resolves.toEqual([]);
    expect(checkpoints).toEqual([
      expect.objectContaining({
        type: 'workflow-checkpoint-saved',
        workflowSessionId: 'turn-1',
        checkpointId: 'checkpoint-1',
        stepNumber: 2,
      }),
    ]);

    const dispose = client.dispose();
    spawnedProcesses[0]!.completeExit();
    await dispose;
  });
});
