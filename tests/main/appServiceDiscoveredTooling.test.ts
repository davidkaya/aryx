import { describe, expect, mock, test } from 'bun:test';

import type { RunTurnCommand } from '@shared/contracts/sidecar';
import type { WorkflowDefinition } from '@shared/domain/workflow';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-25T00:00:00.000Z';

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
    messages: [],
    runs: [],
    ...overrides,
  };
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

describe('AryxAppService discovered tooling', () => {
  test('allows project-discovered MCP servers to be accepted and used in project sessions', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!pattern) {
      throw new Error('Expected a single-agent pattern in the workspace seed.');
    }

    const project = createProject({
      discoveredTooling: {
        mcpServers: [
          {
            id: 'discovered_project_project_alpha_vscode_mcp_git_mcp',
            name: 'Git MCP',
            transport: 'local',
            command: 'node',
            args: ['project-mcp.js'],
            cwd: 'C:\\workspace\\alpha',
            tools: ['git.status'],
            scope: 'project',
            scannerId: 'vscode-mcp',
            sourcePath: 'C:\\workspace\\alpha\\.vscode\\mcp.json',
            sourceLabel: '.vscode\\mcp.json',
            fingerprint: 'fingerprint-project',
            status: 'pending',
          },
        ],
        lastScannedAt: TIMESTAMP,
      },
    });
    const session = createSession(project.id, pattern.id);

    workspace.projects = [project];
    workspace.sessions = [session];
    workspace.selectedProjectId = project.id;
    workspace.selectedWorkflowId = pattern.id;
    workspace.selectedSessionId = session.id;

    let command: RunTurnCommand | undefined;
    const service = createService(workspace, pattern, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.resolveProjectDiscoveredTooling(project.id, [project.discoveredTooling!.mcpServers[0]!.id], 'accept');
    await service.updateSessionTooling(session.id, [project.discoveredTooling!.mcpServers[0]!.id], []);
    await service.sendSessionMessage(session.id, 'Use the project MCP server.');

    expect(command?.tooling?.mcpServers).toEqual([
      {
        id: 'discovered_project_project_alpha_vscode_mcp_git_mcp',
        name: 'Git MCP',
        transport: 'local',
        command: 'node',
        args: ['project-mcp.js'],
        cwd: 'C:\\workspace\\alpha',
        tools: ['git.status'],
      },
    ]);
  });

  test('allows accepted user-discovered MCP servers to be used across projects', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!pattern) {
      throw new Error('Expected a single-agent pattern in the workspace seed.');
    }

    workspace.settings.discoveredUserTooling = {
      mcpServers: [
        {
          id: 'discovered_user_workspace_copilot_user_mcp_github',
          name: 'GitHub MCP',
          transport: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
          tools: ['github.issues'],
          scope: 'user',
          scannerId: 'copilot-user-mcp',
          sourcePath: 'C:\\Users\\tester\\.copilot\\mcp.json',
          sourceLabel: '~\\.copilot\\mcp.json',
          fingerprint: 'fingerprint-user',
          status: 'pending',
        },
      ],
      lastScannedAt: TIMESTAMP,
    };

    const project = createProject();
    const session = createSession(project.id, pattern.id);

    workspace.projects = [project];
    workspace.sessions = [session];
    workspace.selectedProjectId = project.id;
    workspace.selectedWorkflowId = pattern.id;
    workspace.selectedSessionId = session.id;

    let command: RunTurnCommand | undefined;
    const service = createService(workspace, pattern, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.resolveWorkspaceDiscoveredTooling(
      [workspace.settings.discoveredUserTooling.mcpServers[0]!.id],
      'accept',
    );
    await service.updateSessionTooling(
      session.id,
      [workspace.settings.discoveredUserTooling.mcpServers[0]!.id],
      [],
    );
    await service.sendSessionMessage(session.id, 'Use the user MCP server.');

    expect(command?.tooling?.mcpServers).toEqual([
      {
        id: 'discovered_user_workspace_copilot_user_mcp_github',
        name: 'GitHub MCP',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
        tools: ['github.issues'],
      },
    ]);
  });

  test('selecting a session also selects that session project', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!pattern) {
      throw new Error('Expected a single-agent pattern in the workspace seed.');
    }

    const projectAlpha = createProject({
      id: 'project-alpha',
      name: 'alpha',
      path: 'C:\\workspace\\alpha',
    });
    const projectBeta = createProject({
      id: 'project-beta',
      name: 'beta',
      path: 'C:\\workspace\\beta',
    });
    const session = createSession(projectBeta.id, pattern.id, {
      id: 'session-beta',
    });

    workspace.projects = [projectAlpha, projectBeta];
    workspace.sessions = [session];
    workspace.selectedProjectId = projectAlpha.id;

    const service = createService(workspace, pattern);

    const updatedWorkspace = await service.selectSession(session.id);

    expect(updatedWorkspace.selectedSessionId).toBe(session.id);
    expect(updatedWorkspace.selectedProjectId).toBe(projectBeta.id);
  });
});
