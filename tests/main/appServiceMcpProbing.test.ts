import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ProjectRecord } from '@shared/domain/project';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-28T00:00:00.000Z';

type MockProbeResult = {
  serverId: string;
  serverName: string;
  tools: Array<{ name: string; description?: string }>;
  status: 'success' | 'failed';
  error?: string;
};

const probeCalls: string[][] = [];
let probeResults: MockProbeResult[] = [];

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

beforeEach(() => {
  probeCalls.length = 0;
  probeResults = [];
});

function createProject(overrides?: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: 'project-alpha',
    name: 'alpha',
    path: 'C:\\workspace\\alpha',
    addedAt: TIMESTAMP,
    ...overrides,
  };
}

function cloneWorkspaceState(workspace: WorkspaceState): WorkspaceState {
  return JSON.parse(JSON.stringify(workspace)) as WorkspaceState;
}

function createService(workspace: WorkspaceState): {
  service: InstanceType<typeof AryxAppService>;
  snapshots: WorkspaceState[];
} {
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;
  const snapshots: WorkspaceState[] = [];

  internals.loadWorkspace = async () => workspace;
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => {
    snapshots.push(cloneWorkspaceState(nextWorkspace));
    return nextWorkspace;
  };
  internals.probeMcpServers = async (
    servers: Array<{ id: string }>,
    _tokenLookup?: (serverUrl: string) => string | undefined,
    onResult?: (result: MockProbeResult) => void | Promise<void>,
  ) => {
    probeCalls.push(servers.map((server) => server.id));
    for (const result of probeResults) {
      await onResult?.(result);
    }
    return probeResults;
  };

  return { service, snapshots };
}

describe('AryxAppService MCP probing', () => {
  test('probes accepted discovered and manual MCP servers in one batch with incremental workspace updates', async () => {
    const workspace = createWorkspaceSeed();
    const project = createProject({
      discoveredTooling: {
        mcpServers: [
          {
            id: 'project-server',
            name: 'Project MCP',
            transport: 'local',
            command: 'project-mcp',
            args: [],
            tools: [],
            scope: 'project',
            scannerId: 'vscode-mcp',
            sourcePath: 'C:\\workspace\\alpha\\.vscode\\mcp.json',
            sourceLabel: '.vscode\\mcp.json',
            fingerprint: 'project-fingerprint',
            status: 'accepted',
          },
        ],
        lastScannedAt: TIMESTAMP,
      },
    });

    workspace.projects = [project];
    workspace.settings.discoveredUserTooling = {
      mcpServers: [
        {
          id: 'user-server',
          name: 'User MCP',
          transport: 'local',
          command: 'user-mcp',
          args: [],
          tools: [],
          scope: 'user',
          scannerId: 'copilot-user-mcp',
          sourcePath: 'C:\\Users\\tester\\.copilot\\mcp.json',
          sourceLabel: '~\\.copilot\\mcp.json',
          fingerprint: 'user-fingerprint',
          status: 'accepted',
        },
      ],
      lastScannedAt: TIMESTAMP,
    };
    workspace.settings.tooling.mcpServers = [
      {
        id: 'manual-server',
        name: 'Manual MCP',
        transport: 'local',
        command: 'manual-mcp',
        args: [],
        tools: [],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];

    probeResults = [
      {
        serverId: 'project-server',
        serverName: 'Project MCP',
        status: 'success',
        tools: [{ name: 'project.status' }],
      },
      {
        serverId: 'manual-server',
        serverName: 'Manual MCP',
        status: 'success',
        tools: [{ name: 'manual.status' }],
      },
      {
        serverId: 'user-server',
        serverName: 'User MCP',
        status: 'failed',
        tools: [],
        error: 'boom',
      },
    ];

    const { service, snapshots } = createService(workspace);

    await (
      service as unknown as {
        probeAllAcceptedMcpServers: (nextWorkspace: WorkspaceState) => Promise<void>;
      }
    ).probeAllAcceptedMcpServers(workspace);

    expect(probeCalls).toEqual([[
      'user-server',
      'project-server',
      'manual-server',
    ]]);
    expect(snapshots.map((snapshot) => snapshot.mcpProbingServerIds)).toEqual([
      ['user-server', 'project-server', 'manual-server'],
      ['user-server', 'manual-server'],
      ['user-server'],
      undefined,
    ]);
    expect(workspace.projects[0]?.discoveredTooling?.mcpServers[0]?.probedTools).toEqual([
      { name: 'project.status' },
    ]);
    expect(workspace.settings.tooling.mcpServers[0]?.probedTools).toEqual([
      { name: 'manual.status' },
    ]);
    expect(workspace.settings.discoveredUserTooling.mcpServers[0]?.probedTools).toBeUndefined();
  });

  test('tracks probing progress while re-probing matching remote MCP servers after OAuth', async () => {
    const workspace = createWorkspaceSeed();
    workspace.settings.discoveredUserTooling = {
      mcpServers: [
        {
          id: 'discovered-remote',
          name: 'Discovered Remote',
          transport: 'http',
          url: 'https://example.com/mcp',
          headers: { 'X-Test': '1' },
          tools: [],
          scope: 'user',
          scannerId: 'copilot-user-mcp',
          sourcePath: 'C:\\Users\\tester\\.copilot\\mcp.json',
          sourceLabel: '~\\.copilot\\mcp.json',
          fingerprint: 'remote-fingerprint',
          status: 'accepted',
        },
      ],
      lastScannedAt: TIMESTAMP,
    };
    workspace.settings.tooling.mcpServers = [
      {
        id: 'manual-remote',
        name: 'Manual Remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
        tools: [],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];

    probeResults = [
      {
        serverId: 'manual-remote',
        serverName: 'Manual Remote',
        status: 'success',
        tools: [{ name: 'manual.remote' }],
      },
      {
        serverId: 'discovered-remote',
        serverName: 'Discovered Remote',
        status: 'success',
        tools: [{ name: 'discovered.remote' }],
      },
    ];

    const { service, snapshots } = createService(workspace);

    await (
      service as unknown as {
        reprobeServerByUrl: (serverUrl: string) => Promise<void>;
      }
    ).reprobeServerByUrl('https://example.com/mcp');

    expect(probeCalls).toEqual([[
      'manual-remote',
      'discovered-remote',
    ]]);
    expect(snapshots.map((snapshot) => snapshot.mcpProbingServerIds)).toEqual([
      ['manual-remote', 'discovered-remote'],
      ['discovered-remote'],
      undefined,
    ]);
    expect(workspace.settings.tooling.mcpServers[0]?.probedTools).toEqual([
      { name: 'manual.remote' },
    ]);
    expect(workspace.settings.discoveredUserTooling.mcpServers[0]?.probedTools).toEqual([
      { name: 'discovered.remote' },
    ]);
  });
});
