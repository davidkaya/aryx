import { describe, expect, test } from 'bun:test';

import {
  buildRunTurnToolingConfig,
  validateSessionToolingSelectionIds,
} from '@main/sessionToolingConfig';
import type { SessionToolingSelection, WorkspaceToolingSettings } from '@shared/domain/tooling';

const TIMESTAMP = '2026-03-25T00:00:00.000Z';

const TOOLING: WorkspaceToolingSettings = {
  mcpServers: [
    {
      id: 'mcp-git',
      name: 'Git MCP',
      transport: 'local',
      command: 'node',
      args: ['server.js'],
      cwd: 'C:\\workspace\\repo',
      env: { DEBUG: 'true' },
      tools: ['git.status'],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    {
      id: 'mcp-remote',
      name: 'Remote MCP',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      tools: ['remote.tool'],
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

describe('session tooling config helpers', () => {
  test('validates selected tooling ids against configured workspace tooling', () => {
    const selection: SessionToolingSelection = {
      enabledMcpServerIds: ['mcp-git'],
      enabledLspProfileIds: ['lsp-ts'],
    };

    expect(() => validateSessionToolingSelectionIds(TOOLING, selection)).not.toThrow();
    expect(() =>
      validateSessionToolingSelectionIds(TOOLING, {
        enabledMcpServerIds: ['missing-mcp'],
        enabledLspProfileIds: [],
      }),
    ).toThrow('Unknown MCP server "missing-mcp".');
    expect(() =>
      validateSessionToolingSelectionIds(TOOLING, {
        enabledMcpServerIds: [],
        enabledLspProfileIds: ['missing-lsp'],
      }),
    ).toThrow('Unknown LSP profile "missing-lsp".');
  });

  test('builds a run-turn tooling config from selected MCP and LSP ids', () => {
    expect(
      buildRunTurnToolingConfig(TOOLING, {
        enabledMcpServerIds: ['mcp-git', 'mcp-remote'],
        enabledLspProfileIds: ['lsp-ts'],
      }),
    ).toEqual({
      mcpServers: [
        {
          id: 'mcp-git',
          name: 'Git MCP',
          transport: 'local',
          tools: ['git.status'],
          command: 'node',
          args: ['server.js'],
          cwd: 'C:\\workspace\\repo',
          env: { DEBUG: 'true' },
        },
        {
          id: 'mcp-remote',
          name: 'Remote MCP',
          transport: 'http',
          tools: ['remote.tool'],
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
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
    });
  });

  test('returns undefined when no session tooling is selected', () => {
    expect(
      buildRunTurnToolingConfig(TOOLING, {
        enabledMcpServerIds: [],
        enabledLspProfileIds: [],
      }),
    ).toBeUndefined();
  });

  test('injects OAuth token as Authorization header for remote MCP servers', () => {
    const tokenLookup = (url: string) =>
      url === 'https://example.com/mcp' ? 'oauth-access-token' : undefined;

    const config = buildRunTurnToolingConfig(
      TOOLING,
      { enabledMcpServerIds: ['mcp-remote'], enabledLspProfileIds: [] },
      tokenLookup,
    );

    expect(config?.mcpServers[0]).toMatchObject({
      id: 'mcp-remote',
      headers: { Authorization: 'Bearer oauth-access-token' },
    });
  });

  test('preserves existing headers when injecting OAuth token', () => {
    const toolingWithHeaders: WorkspaceToolingSettings = {
      ...TOOLING,
      mcpServers: [
        {
          id: 'mcp-custom',
          name: 'Custom MCP',
          transport: 'http',
          url: 'https://custom.example.com/mcp',
          headers: { 'X-Custom': 'value' },
          tools: [],
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
    };

    const config = buildRunTurnToolingConfig(
      toolingWithHeaders,
      { enabledMcpServerIds: ['mcp-custom'], enabledLspProfileIds: [] },
      () => 'my-token',
    );

    expect(config?.mcpServers[0].headers).toEqual({
      'X-Custom': 'value',
      Authorization: 'Bearer my-token',
    });
  });

  test('does not inject Authorization header when no token is available', () => {
    const config = buildRunTurnToolingConfig(
      TOOLING,
      { enabledMcpServerIds: ['mcp-remote'], enabledLspProfileIds: [] },
      () => undefined,
    );

    expect(config?.mcpServers[0].headers).toEqual({ Authorization: 'Bearer token' });
  });
});
