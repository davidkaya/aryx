import { describe, expect, mock, test } from 'bun:test';

import type { RunTurnCommand } from '@shared/contracts/sidecar';
import type { PatternDefinition } from '@shared/domain/pattern';
import { createScratchpadProject } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-25T00:00:00.000Z';
const SCRATCHPAD_PATH = 'C:\\workspace\\personal\\repositories\\eryx\\scratchpad';

mock.module('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'C:\\workspace\\personal\\repositories\\eryx',
    getPath: () => 'C:\\workspace\\personal\\repositories\\eryx\\tests\\fixtures',
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  shell: {
    openPath: async () => '',
  },
}));

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { EryxAppService } = await import('@main/EryxAppService');

function createWorkspaceFixture(): {
  workspace: WorkspaceState;
  pattern: PatternDefinition;
  session: SessionRecord;
} {
  const workspace = createWorkspaceSeed();
  const pattern = workspace.patterns.find((candidate) => candidate.mode === 'single');
  if (!pattern) {
    throw new Error('Expected the workspace seed to include a single-agent pattern.');
  }

  const project = createScratchpadProject(SCRATCHPAD_PATH, TIMESTAMP);
  const session: SessionRecord = {
    id: 'session-scratchpad',
    projectId: project.id,
    patternId: pattern.id,
    title: 'Scratchpad',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [],
    runs: [],
  };

  workspace.projects = [project];
  workspace.sessions = [session];
  workspace.selectedProjectId = project.id;
  workspace.selectedPatternId = pattern.id;
  workspace.selectedSessionId = session.id;
  workspace.settings.tooling = {
    mcpServers: [
      {
        id: 'mcp-git',
        name: 'Git MCP',
        transport: 'local',
        command: 'node',
        args: ['server.js', '--stdio'],
        cwd: 'C:\\workspace\\personal\\repositories\\eryx',
        tools: ['git.status'],
        timeoutMs: 1500,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ],
    lspProfiles: [
      {
        id: 'lsp-ts',
        name: 'TypeScript',
        command: 'typescript-language-server',
        args: ['--stdio'],
        languageId: 'typescript',
        fileExtensions: ['.ts', '.tsx'],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ],
  };

  return { workspace, pattern, session };
}

function createService(
  workspace: WorkspaceState,
  pattern: PatternDefinition,
  options?: {
    captureRunTurn?: (command: RunTurnCommand) => void;
    knownApprovalToolNames?: string[];
  },
): InstanceType<typeof EryxAppService> {
  const service = new EryxAppService();
  const internals = service as unknown as Record<string, unknown>;
  internals.loadWorkspace = async () => workspace;
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => nextWorkspace;
  internals.buildEffectivePattern = async () => pattern;
  internals.awaitFinalResponseApproval = async () => undefined;
  internals.finalizeTurn = () => undefined;
  internals.emitSessionEvent = () => undefined;
  internals.listKnownApprovalToolNames = async () =>
    options?.knownApprovalToolNames ?? ['glob', 'git.status', 'lsp_lsp_ts_definition'];
  (
    service as unknown as {
      sidecar: {
        runTurn: (
          command: RunTurnCommand,
          onDelta: unknown,
          onActivity: unknown,
          onApproval: unknown,
        ) => Promise<[]>;
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

describe('EryxAppService scratchpad tooling support', () => {
  test('allows scratchpad sessions to save MCP and LSP selections', async () => {
    const { workspace, pattern, session } = createWorkspaceFixture();
    const service = createService(workspace, pattern);

    await service.updateSessionTooling(session.id, ['mcp-git'], ['lsp-ts']);

    expect(session.tooling).toEqual({
      enabledMcpServerIds: ['mcp-git'],
      enabledLspProfileIds: ['lsp-ts'],
    });
  });

  test('allows scratchpad sessions to save auto-approved tool overrides', async () => {
    const { workspace, pattern, session } = createWorkspaceFixture();
    const service = createService(workspace, pattern, {
      knownApprovalToolNames: ['glob', 'git.status', 'lsp_lsp_ts_definition'],
    });

    await service.updateSessionApprovalSettings(session.id, ['glob', 'git.status']);

    expect(session.approvalSettings).toEqual({
      autoApprovedToolNames: ['glob', 'git.status'],
    });
  });

  test('sends scratchpad-selected tooling to the sidecar run-turn command', async () => {
    const { workspace, pattern, session } = createWorkspaceFixture();
    session.tooling = {
      enabledMcpServerIds: ['mcp-git'],
      enabledLspProfileIds: ['lsp-ts'],
    };

    let command: RunTurnCommand | undefined;
    const service = createService(workspace, pattern, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.sendSessionMessage(session.id, 'Inspect the scratchpad tooling wiring.');

    expect(command).toMatchObject({
      sessionId: session.id,
      projectPath: SCRATCHPAD_PATH,
      workspaceKind: 'scratchpad',
      tooling: {
        mcpServers: [
          {
            id: 'mcp-git',
            name: 'Git MCP',
            transport: 'local',
            command: 'node',
            args: ['server.js', '--stdio'],
            cwd: 'C:\\workspace\\personal\\repositories\\eryx',
            tools: ['git.status'],
            timeoutMs: 1500,
          },
        ],
        lspProfiles: [
          {
            id: 'lsp-ts',
            name: 'TypeScript',
            command: 'typescript-language-server',
            args: ['--stdio'],
            languageId: 'typescript',
            fileExtensions: ['.ts', '.tsx'],
          },
        ],
      },
    });
  });
});
