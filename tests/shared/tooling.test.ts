import { describe, expect, test } from 'bun:test';

import {
  normalizeWorkspaceSettings,
  validateLspProfileDefinition,
  validateMcpServerDefinition,
  type LspProfileDefinition,
  type McpServerDefinition,
} from '@shared/domain/tooling';

const TIMESTAMP = '2026-03-23T00:00:00.000Z';

describe('tooling settings helpers', () => {
  test('normalizes persisted MCP and LSP definitions into trimmed stable settings', () => {
    const workspaceSettings = normalizeWorkspaceSettings({
      tooling: {
        mcpServers: [
          {
            id: 'mcp-local',
            name: ' Local MCP ',
            transport: 'local',
            command: ' node ',
            args: [' --stdio ', ' --stdio ', ''],
            cwd: ' C:\\workspace\\repo ',
            tools: [' git.status ', '', ' git.status '],
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP,
          },
          {
            id: 'mcp-remote',
            name: ' Remote MCP ',
            transport: 'http',
            url: ' https://example.com/mcp ',
            tools: [],
            timeoutMs: 1000,
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP,
          },
        ],
        lspProfiles: [
          {
            id: 'lsp-ts',
            name: ' TypeScript ',
            command: ' typescript-language-server ',
            args: [' --stdio ', ' --stdio ', ''],
            languageId: ' typescript ',
            fileExtensions: ['ts', ' .tsx ', ''],
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP,
          },
        ],
      },
    });

    expect(workspaceSettings).toEqual({
      tooling: {
        mcpServers: [
          {
            id: 'mcp-local',
            name: 'Local MCP',
            transport: 'local',
            command: 'node',
            args: ['--stdio'],
            cwd: 'C:\\workspace\\repo',
            tools: ['git.status'],
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP,
          },
          {
            id: 'mcp-remote',
            name: 'Remote MCP',
            transport: 'http',
            url: 'https://example.com/mcp',
            tools: [],
            timeoutMs: 1000,
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
      },
    });
  });

  test('validates required MCP transport settings', () => {
    const localServer: McpServerDefinition = {
      id: 'mcp-local',
      name: 'Local MCP',
      transport: 'local',
      command: '',
      args: [],
      tools: ['*'],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };
    const remoteServer: McpServerDefinition = {
      id: 'mcp-remote',
      name: 'Remote MCP',
      transport: 'sse',
      url: 'not-a-url',
      tools: ['*'],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };

    expect(validateMcpServerDefinition(localServer)).toBe('MCP server "Local MCP" needs a command.');
    expect(validateMcpServerDefinition(remoteServer)).toBe('MCP server "Remote MCP" has an invalid URL.');
  });

  test('validates required LSP profile settings', () => {
    const profile: LspProfileDefinition = {
      id: 'lsp-empty',
      name: 'TypeScript',
      command: '',
      args: [],
      languageId: 'typescript',
      fileExtensions: [],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };

    expect(validateLspProfileDefinition(profile)).toBe('LSP profile "TypeScript" needs a command.');
    expect(
      validateLspProfileDefinition({
        ...profile,
        command: 'typescript-language-server',
        args: ['--stdio'],
      }),
    ).toBe('LSP profile "TypeScript" needs at least one file extension.');
  });

  test('requires the stdio flag for the TypeScript language server profile', () => {
    expect(
      validateLspProfileDefinition({
        id: 'lsp-ts',
        name: 'Typescript LSP',
        command: 'typescript-language-server',
        args: [],
        languageId: 'typescript',
        fileExtensions: ['.ts', '.tsx'],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      }),
    ).toBe('LSP profile "Typescript LSP" needs the "--stdio" argument.');
  });
});
