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
      tools: ['git.status'],
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
        enabledMcpServerIds: ['mcp-git'],
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
});
