import { describe, expect, mock, test } from 'bun:test';

import type { SessionEventRecord } from '@shared/domain/event';
import type { WorkflowDiagnosticEvent } from '@shared/contracts/sidecar';

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

describe('AryxAppService workflow diagnostics', () => {
  test('maps turn-scoped workflow diagnostics to session events', async () => {
    const service = new AryxAppService();
    const captured: SessionEventRecord[] = [];
    const workflowDiagnostic: WorkflowDiagnosticEvent = {
      type: 'workflow-diagnostic',
      requestId: 'turn-1',
      sessionId: 'session-1',
      severity: 'error',
      diagnosticKind: 'executor-failed',
      message: 'Tool crashed.',
      agentId: 'agent-1',
      agentName: 'Primary',
      executorId: 'agent-1',
      exceptionType: 'InvalidOperationException',
    };

    const internals = service as unknown as {
      emitSessionEvent: (event: SessionEventRecord) => void;
      handleTurnScopedEvent: (
        workspace: unknown,
        sessionId: string,
        event: WorkflowDiagnosticEvent,
      ) => void | Promise<void>;
    };
    internals.emitSessionEvent = (event) => {
      captured.push(event);
    };

    await internals.handleTurnScopedEvent({}, 'session-1', workflowDiagnostic);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      sessionId: 'session-1',
      kind: 'workflow-diagnostic',
      agentId: 'agent-1',
      agentName: 'Primary',
      diagnosticSeverity: 'error',
      diagnosticKind: 'executor-failed',
      diagnosticMessage: 'Tool crashed.',
      executorId: 'agent-1',
      exceptionType: 'InvalidOperationException',
    });
    expect(captured[0]?.occurredAt).toEqual(expect.any(String));
  });
});
