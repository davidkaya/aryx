import { describe, expect, test } from 'bun:test';

import {
  applyDiscoveredMcpServerStatus,
  buildDiscoveredMcpServerFingerprint,
  buildDiscoveredMcpServerId,
  listAcceptedDiscoveredMcpServers,
  listPendingDiscoveredMcpServers,
  mergeDiscoveredToolingState,
  normalizeDiscoveredToolingState,
  type DiscoveredLocalMcpServer,
} from '@shared/domain/discoveredTooling';

const TIMESTAMP = '2026-03-25T00:00:00.000Z';

function createDiscoveredServer(overrides?: Partial<DiscoveredLocalMcpServer>): DiscoveredLocalMcpServer {
  const server: DiscoveredLocalMcpServer = {
    id: buildDiscoveredMcpServerId('project', 'project-alpha', 'vscode-mcp', 'Git MCP'),
    name: 'Git MCP',
    transport: 'local',
    command: 'node',
    args: ['server.js'],
    cwd: 'C:\\workspace\\repo',
    tools: ['git.status'],
    scope: 'project',
    scannerId: 'vscode-mcp',
    sourcePath: 'C:\\workspace\\repo\\.vscode\\mcp.json',
    sourceLabel: '.vscode\\mcp.json',
    fingerprint: '',
    status: 'pending',
  };

  return {
    ...server,
    ...overrides,
    fingerprint: buildDiscoveredMcpServerFingerprint({
      ...server,
      ...overrides,
      fingerprint: '',
      status: 'pending',
    }),
  };
}

describe('discovered tooling helpers', () => {
  test('normalizes discovered servers and preserves accepted status when the fingerprint is unchanged', () => {
    const current = {
      mcpServers: [
        createDiscoveredServer({
          status: 'accepted',
        }),
      ],
      lastScannedAt: TIMESTAMP,
    };

    const merged = mergeDiscoveredToolingState(current, [createDiscoveredServer()], '2026-03-25T01:00:00.000Z');

    expect(merged.mcpServers[0]?.status).toBe('accepted');
    expect(merged.lastScannedAt).toBe('2026-03-25T01:00:00.000Z');
  });

  test('marks changed servers as pending on re-scan', () => {
    const current = {
      mcpServers: [
        createDiscoveredServer({
          status: 'accepted',
        }),
      ],
      lastScannedAt: TIMESTAMP,
    };

    const merged = mergeDiscoveredToolingState(
      current,
      [
        createDiscoveredServer({
          args: ['server.js', '--debug'],
        }),
      ],
      '2026-03-25T01:00:00.000Z',
    );

    expect(merged.mcpServers[0]?.status).toBe('pending');
  });

  test('applies explicit accept and dismiss resolutions', () => {
    const state = normalizeDiscoveredToolingState({
      mcpServers: [
        createDiscoveredServer(),
        createDiscoveredServer({
          id: buildDiscoveredMcpServerId('user', 'workspace', 'copilot-user-mcp', 'Git MCP'),
          scope: 'user',
          scannerId: 'copilot-user-mcp',
          sourcePath: 'C:\\Users\\tester\\.copilot\\mcp.json',
          sourceLabel: '~\\.copilot\\mcp.json',
        }),
      ],
    });

    const accepted = applyDiscoveredMcpServerStatus(state, [state.mcpServers[0]!.id], 'accepted');
    const dismissed = applyDiscoveredMcpServerStatus(accepted, [state.mcpServers[1]!.id], 'dismissed');

    expect(listAcceptedDiscoveredMcpServers(dismissed).map((server) => server.id)).toEqual([
      state.mcpServers[0]!.id,
    ]);
    expect(listPendingDiscoveredMcpServers(dismissed)).toEqual([]);
    expect(dismissed.mcpServers[1]?.status).toBe('dismissed');
  });
});
