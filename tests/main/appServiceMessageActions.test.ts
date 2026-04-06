import { describe, expect, mock, test } from 'bun:test';

import type { RunTurnCommand } from '@shared/contracts/sidecar';
import type { WorkflowDefinition } from '@shared/domain/workflow';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-29T00:00:00.000Z';

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

function createProject(overrides?: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: 'project-alpha',
    name: 'alpha',
    path: 'C:\\workspace\\alpha',
    addedAt: TIMESTAMP,
    ...overrides,
  };
}

function createSession(projectId: string, workflowId: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-alpha',
    projectId,
    workflowId,
    title: 'Alpha session',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        authorName: 'You',
        content: 'Investigate the refresh bug.',
        createdAt: '2026-03-29T00:00:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        authorName: 'Primary Agent',
        content: 'Here is the first answer.',
        createdAt: '2026-03-29T00:01:00.000Z',
      },
      {
        id: 'msg-3',
        role: 'user',
        authorName: 'You',
        content: 'Try again with more focus on session state.',
        createdAt: '2026-03-29T00:02:00.000Z',
        attachments: [
          {
            type: 'file',
            path: 'C:\\workspace\\alpha\\notes.txt',
            displayName: 'notes.txt',
          },
        ],
      },
      {
        id: 'msg-4',
        role: 'assistant',
        authorName: 'Primary Agent',
        content: 'Here is the revised answer.',
        createdAt: '2026-03-29T00:03:00.000Z',
      },
    ],
    runs: [],
    ...overrides,
  };
}

function createFixture(): {
  workspace: WorkspaceState;
  pattern: WorkflowDefinition;
  project: ProjectRecord;
  session: SessionRecord;
} {
  const workspace = createWorkspaceSeed();
  const pattern = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
  if (!pattern) {
    throw new Error('Expected the workspace seed to include a single-agent pattern.');
  }

  const project = createProject();
  const session = createSession(project.id, pattern.id);

  workspace.projects = [project];
  workspace.sessions = [session];
  workspace.selectedProjectId = project.id;
  workspace.selectedWorkflowId = pattern.id;
  workspace.selectedSessionId = session.id;

  return { workspace, pattern, project, session };
}

function createService(
  workspace: WorkspaceState,
  pattern: WorkflowDefinition,
  options?: {
    captureRunTurn?: (command: RunTurnCommand) => void;
  },
): InstanceType<typeof AryxAppService> {
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;
  internals.loadWorkspace = async () => workspace;
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => nextWorkspace;
  internals.buildEffectivePattern = async () => pattern;
  internals.awaitFinalResponseApproval = async () => undefined;
  internals.finalizeTurn = () => undefined;
  internals.emitSessionEvent = () => undefined;
  internals.pruneUnavailableApprovalTools = async () => false;
  internals.pruneUnavailableSessionToolingSelections = () => false;
  (
    service as unknown as {
      sidecar: {
        runTurn: (command: RunTurnCommand) => Promise<[]>;
        resolveApproval: () => Promise<void>;
      };
    }
  ).sidecar = {
    runTurn: async (command) => {
      options?.captureRunTurn?.(command);
      return [];
    },
    resolveApproval: async () => undefined,
  };

  return service;
}

describe('AryxAppService message actions', () => {
  test('setSessionMessagePinned persists pinned message state', async () => {
    const { workspace, pattern, session } = createFixture();
    const service = createService(workspace, pattern);

    const updated = await service.setSessionMessagePinned(session.id, 'msg-2', true);

    expect(updated.sessions[0]?.messages[1]?.isPinned).toBe(true);
    expect(session.messages[1]?.isPinned).toBe(true);
  });

  test('regenerateSessionMessage creates a replay branch from the prior user turn', async () => {
    const { workspace, pattern, session } = createFixture();
    let command: RunTurnCommand | undefined;
    const service = createService(workspace, pattern, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.regenerateSessionMessage(session.id, 'msg-4');

    const regenerated = workspace.sessions[0];
    if (!regenerated) {
      throw new Error('Expected regenerateSessionMessage to prepend a new session.');
    }

    expect(regenerated.id).not.toBe(session.id);
    expect(regenerated.branchOrigin).toMatchObject({
      sourceSessionId: session.id,
      sourceMessageId: 'msg-4',
      sourceMessageIndex: 3,
      action: 'regenerate',
    });
    expect(regenerated.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(workspace.selectedSessionId).toBe(regenerated.id);
    expect(command?.sessionId).toBe(regenerated.id);
    expect(command?.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  test('editAndResendSessionMessage creates an implicit branch with the edited prompt', async () => {
    const { workspace, pattern, session } = createFixture();
    let command: RunTurnCommand | undefined;
    const service = createService(workspace, pattern, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.editAndResendSessionMessage(session.id, 'msg-3', '  Focus only on session state.  ');

    const edited = workspace.sessions[0];
    if (!edited) {
      throw new Error('Expected editAndResendSessionMessage to prepend a new session.');
    }

    expect(edited.id).not.toBe(session.id);
    expect(edited.branchOrigin).toMatchObject({
      sourceSessionId: session.id,
      sourceMessageId: 'msg-3',
      sourceMessageIndex: 2,
      action: 'edit-and-resend',
    });
    expect(edited.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(edited.messages[2]).toMatchObject({
      id: 'msg-3',
      role: 'user',
      content: '  Focus only on session state.  ',
      attachments: [
        {
          type: 'file',
          path: 'C:\\workspace\\alpha\\notes.txt',
          displayName: 'notes.txt',
        },
      ],
    });
    expect(edited.messages[2]?.attachments).not.toBe(session.messages[2]?.attachments);
    expect(workspace.selectedSessionId).toBe(edited.id);
    expect(command?.sessionId).toBe(edited.id);
    expect(command?.messages[2]?.content).toBe('  Focus only on session state.  ');
  });
});
