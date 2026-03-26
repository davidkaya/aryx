import { describe, expect, test } from 'bun:test';

import {
  listApprovalToolDefinitions,
  normalizeWorkspaceSettings,
  resolveProjectToolingSettings,
  resolveToolLabel,
  resolveWorkspaceToolingSettings,
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
            env: { ' DEBUG ': ' true ', EMPTY: ' ' },
            tools: [' git.status ', '', ' git.status '],
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP,
          },
          {
            id: 'mcp-remote',
            name: ' Remote MCP ',
            transport: 'http',
            url: ' https://example.com/mcp ',
            headers: { ' Authorization ': ' Bearer token ', Empty: ' ' },
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
      theme: 'dark',
      tooling: {
        mcpServers: [
          {
            id: 'mcp-local',
            name: 'Local MCP',
            transport: 'local',
            command: 'node',
            args: ['--stdio'],
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
      discoveredUserTooling: {
        mcpServers: [],
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

  test('lists builtin, MCP, and LSP approval tools using runtime tool identifiers', () => {
    const tools = listApprovalToolDefinitions({
      mcpServers: [
        {
          id: 'mcp-git',
          name: 'Git MCP',
          transport: 'local',
          command: 'node',
          args: ['server.js'],
          tools: ['git.status', 'git.diff'],
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
        {
          id: 'mcp-extra',
          name: 'Extra MCP',
          transport: 'local',
          command: 'node',
          args: ['extra.js'],
          tools: ['git.status'],
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
      lspProfiles: [
        {
          id: 'ts',
          name: 'TypeScript',
          command: 'typescript-language-server',
          args: ['--stdio'],
          languageId: 'typescript',
          fileExtensions: ['.ts', '.tsx'],
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
    });

    expect(tools).toContainEqual({
      id: 'web_fetch',
      label: 'Fetch web content',
      kind: 'builtin',
      providerIds: ['builtin:web_fetch'],
      providerNames: ['Built-in'],
    });
    expect(tools).toContainEqual({
      id: 'git.status',
      label: 'git.status',
      kind: 'mcp',
      providerIds: ['mcp-git', 'mcp-extra'],
      providerNames: ['Git MCP', 'Extra MCP'],
    });
    expect(tools).toContainEqual({
      id: 'lsp_ts_hover',
      label: 'TypeScript · Hover',
      kind: 'lsp',
      providerIds: ['ts'],
      providerNames: ['TypeScript'],
    });
  });

  test('prefers dynamically reported runtime tools over the fallback builtin catalog', () => {
    const tools = listApprovalToolDefinitions(
      { mcpServers: [], lspProfiles: [] },
      [
        {
          id: 'fetch',
          label: 'fetch',
          description: 'Dynamic runtime tool from Copilot CLI.',
        },
      ],
    );

    expect(tools).toContainEqual({
      id: 'fetch',
      label: 'fetch',
      description: 'Dynamic runtime tool from Copilot CLI.',
      kind: 'builtin',
      providerIds: ['builtin:fetch'],
      providerNames: ['Built-in'],
    });
    expect(tools.some((tool) => tool.id === 'web_fetch')).toBe(false);
  });

  test('resolves human-readable labels from the tool metadata registry', () => {
    expect(resolveToolLabel('bash')).toBe('Execute shell commands');
    expect(resolveToolLabel('read_bash')).toBe('Read shell output');
    expect(resolveToolLabel('web_fetch')).toBe('Fetch web content');
    expect(resolveToolLabel('fetch_copilot_cli_documentation')).toBe('Fetch CLI docs');
    expect(resolveToolLabel('glob')).toBe('Find files by pattern');
    expect(resolveToolLabel('lsp')).toBe('Language server');
  });

  test('passes through unknown tool IDs as labels', () => {
    expect(resolveToolLabel('my_custom_tool')).toBe('my_custom_tool');
    expect(resolveToolLabel('')).toBe('');
  });

  test('fallback catalog includes all standard non-internal tools with friendly labels', () => {
    const tools = listApprovalToolDefinitions({ mcpServers: [], lspProfiles: [] });
    const builtinTools = tools.filter((t) => t.kind === 'builtin');

    expect(builtinTools.length).toBeGreaterThanOrEqual(20);
    expect(builtinTools.some((t) => t.id === 'bash')).toBe(true);
    expect(builtinTools.some((t) => t.id === 'web_fetch')).toBe(true);
    expect(builtinTools.some((t) => t.id === 'task')).toBe(true);
    expect(builtinTools.some((t) => t.id === 'store_memory')).toBe(true);

    // Labels should be human-readable, not raw IDs
    const bashTool = builtinTools.find((t) => t.id === 'bash');
    expect(bashTool?.label).toBe('Execute shell commands');

    // Internal tools should not appear in the fallback
    expect(builtinTools.some((t) => t.id === 'ask_user')).toBe(false);
    expect(builtinTools.some((t) => t.id === 'report_intent')).toBe(false);
    expect(builtinTools.some((t) => t.id === 'task_complete')).toBe(false);
    expect(builtinTools.some((t) => t.id === 'exit_plan_mode')).toBe(false);
  });

  test('resolves workspace and project tooling with accepted discovered MCP servers', () => {
    const workspaceTooling = resolveWorkspaceToolingSettings(normalizeWorkspaceSettings({
      tooling: {
        mcpServers: [
          {
            id: 'manual',
            name: 'Manual MCP',
            transport: 'local',
            command: 'node',
            args: ['manual.js'],
            tools: ['manual.tool'],
            createdAt: TIMESTAMP,
            updatedAt: TIMESTAMP,
          },
        ],
        lspProfiles: [],
      },
      discoveredUserTooling: {
        mcpServers: [
          {
            id: 'user-discovered',
            name: 'User MCP',
            transport: 'local',
            command: 'node',
            args: ['user.js'],
            tools: ['user.tool'],
            scope: 'user',
            scannerId: 'copilot-user-mcp',
            sourcePath: 'C:\\Users\\tester\\.copilot\\mcp.json',
            sourceLabel: '~\\.copilot\\mcp.json',
            fingerprint: 'fp-user',
            status: 'accepted',
          },
        ],
      },
    }));

    expect(workspaceTooling.mcpServers.map((server) => server.id)).toEqual(['manual', 'user-discovered']);

    const projectTooling = resolveProjectToolingSettings(
      normalizeWorkspaceSettings({
        tooling: {
          mcpServers: [],
          lspProfiles: [],
        },
        discoveredUserTooling: {
          mcpServers: [],
        },
      }),
      {
        mcpServers: [
          {
            id: 'project-discovered',
            name: 'Project MCP',
            transport: 'http',
            url: 'https://example.com/project',
            headers: { Authorization: 'Bearer token' },
            tools: ['project.tool'],
            scope: 'project',
            scannerId: 'vscode-mcp',
            sourcePath: 'C:\\workspace\\repo\\.vscode\\mcp.json',
            sourceLabel: '.vscode\\mcp.json',
            fingerprint: 'fp-project',
            status: 'accepted',
          },
        ],
      },
    );

    expect(projectTooling.mcpServers).toContainEqual({
      id: 'project-discovered',
      name: 'Project MCP',
      transport: 'http',
      url: 'https://example.com/project',
      headers: { Authorization: 'Bearer token' },
      tools: ['project.tool'],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });
});
