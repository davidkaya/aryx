import { describe, expect, test } from 'bun:test';

import type { DiscoveredLocalMcpServer } from '@shared/domain/discoveredTooling';
import { listPendingDiscoveredMcpServers, normalizeDiscoveredToolingState, type DiscoveredToolingState } from '@shared/domain/discoveredTooling';
import { resolveProjectToolingSettings, createWorkspaceSettings, type WorkspaceSettings } from '@shared/domain/tooling';

function makeDiscoveredServer(
  overrides: Partial<DiscoveredLocalMcpServer> & { id: string; name: string },
): DiscoveredLocalMcpServer {
  return {
    transport: 'local',
    command: 'test-cmd',
    args: [],
    tools: [],
    scope: 'user',
    scannerId: 'test-scanner',
    sourcePath: '/test/path',
    sourceLabel: 'test config',
    fingerprint: 'fnv1a_00000001',
    status: 'pending',
    ...overrides,
  };
}

describe('frontend discovered tooling integration', () => {
  test('pending discovery detection drives modal visibility', () => {
    const emptyState: DiscoveredToolingState = { mcpServers: [], lastScannedAt: undefined };
    expect(listPendingDiscoveredMcpServers(emptyState)).toHaveLength(0);

    const withPending: DiscoveredToolingState = {
      mcpServers: [
        makeDiscoveredServer({ id: 'discovered_user_test_scanner_alpha', name: 'alpha', status: 'pending' }),
        makeDiscoveredServer({ id: 'discovered_user_test_scanner_beta', name: 'beta', status: 'accepted' }),
      ],
    };
    expect(listPendingDiscoveredMcpServers(withPending)).toHaveLength(1);
    expect(listPendingDiscoveredMcpServers(withPending)[0].name).toBe('alpha');
  });

  test('effective project tooling merges accepted discovered MCPs for session UI', () => {
    const settings: WorkspaceSettings = {
      ...createWorkspaceSettings(),
      discoveredUserTooling: normalizeDiscoveredToolingState({
        mcpServers: [
          makeDiscoveredServer({
            id: 'discovered_user_ws_scanner_user_mcp',
            name: 'user-mcp',
            status: 'accepted',
            scope: 'user',
          }),
        ],
      }),
    };

    const projectTooling = normalizeDiscoveredToolingState({
      mcpServers: [
        makeDiscoveredServer({
          id: 'discovered_project_proj_scanner_proj_mcp',
          name: 'proj-mcp',
          status: 'accepted',
          scope: 'project',
        }),
      ],
    });

    const effective = resolveProjectToolingSettings(settings, projectTooling);
    const serverIds = effective.mcpServers.map((s) => s.id);

    expect(serverIds).toContain('discovered_user_ws_scanner_user_mcp');
    expect(serverIds).toContain('discovered_project_proj_scanner_proj_mcp');
  });

  test('MCP server IDs are correctly categorized by prefix for tool grouping', () => {
    const settings: WorkspaceSettings = {
      ...createWorkspaceSettings(),
      tooling: {
        mcpServers: [
          { id: 'mcp-manual', name: 'manual', transport: 'local', command: 'cmd', args: [], tools: [], createdAt: '', updatedAt: '' },
        ],
        lspProfiles: [],
      },
      discoveredUserTooling: normalizeDiscoveredToolingState({
        mcpServers: [
          makeDiscoveredServer({
            id: 'discovered_user_ws_scanner_user_srv',
            name: 'user-srv',
            status: 'accepted',
            scope: 'user',
          }),
        ],
      }),
    };

    const projectTooling = normalizeDiscoveredToolingState({
      mcpServers: [
        makeDiscoveredServer({
          id: 'discovered_project_proj_scanner_proj_srv',
          name: 'proj-srv',
          status: 'accepted',
          scope: 'project',
        }),
      ],
    });

    const effective = resolveProjectToolingSettings(settings, projectTooling);

    const workspaceMcp = effective.mcpServers.filter((s) => !s.id.startsWith('discovered_'));
    const userDiscovered = effective.mcpServers.filter((s) => s.id.startsWith('discovered_user_'));
    const projectDiscovered = effective.mcpServers.filter((s) => s.id.startsWith('discovered_project_'));

    expect(workspaceMcp).toHaveLength(1);
    expect(workspaceMcp[0].name).toBe('manual');

    expect(userDiscovered).toHaveLength(1);
    expect(userDiscovered[0].name).toBe('user-srv');

    expect(projectDiscovered).toHaveLength(1);
    expect(projectDiscovered[0].name).toBe('proj-srv');
  });
});
