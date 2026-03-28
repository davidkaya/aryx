import { describe, expect, test } from 'bun:test';

import {
  buildMcpServerApprovalKey,
  groupApprovalToolsByProvider,
  listApprovalToolDefinitions,
  listApprovalToolNames,
  normalizeWorkspaceSettings,
  resolveProjectToolingSettings,
  resolveToolLabel,
  resolveWorkspaceToolingSettings,
  validateLspProfileDefinition,
  validateMcpServerDefinition,
  type LspProfileDefinition,
  type McpServerDefinition,
  type WorkspaceToolingSettings,
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

  test('always uses category-level builtins regardless of dynamically reported runtime tools', () => {
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

    // Category-level builtins must always be present
    expect(tools.some((tool) => tool.id === 'read')).toBe(true);
    expect(tools.some((tool) => tool.id === 'write')).toBe(true);
    expect(tools.some((tool) => tool.id === 'shell')).toBe(true);
    expect(tools.some((tool) => tool.id === 'web_fetch')).toBe(true);
    expect(tools.some((tool) => tool.id === 'store_memory')).toBe(true);

    // Dynamic individual tools do NOT appear in the approval list
    expect(tools.some((tool) => tool.id === 'fetch')).toBe(false);
  });

  test('resolves human-readable labels from the tool metadata registry', () => {
    expect(resolveToolLabel('bash')).toBe('Execute shell commands');
    expect(resolveToolLabel('read_bash')).toBe('Read shell output');
    expect(resolveToolLabel('web_fetch')).toBe('Fetch web content');
    expect(resolveToolLabel('fetch_copilot_cli_documentation')).toBe('Fetch CLI docs');
    expect(resolveToolLabel('glob')).toBe('Find files by pattern');
    expect(resolveToolLabel('lsp')).toBe('Language server');
    expect(resolveToolLabel('shell')).toBe('Shell commands');
    expect(resolveToolLabel('read')).toBe('Read files');
    expect(resolveToolLabel('write')).toBe('Write files');
  });

  test('passes through unknown tool IDs as labels', () => {
    expect(resolveToolLabel('my_custom_tool')).toBe('my_custom_tool');
    expect(resolveToolLabel('')).toBe('');
  });

  test('fallback catalog uses 5 permission-category entries for built-in tools', () => {
    const tools = listApprovalToolDefinitions({ mcpServers: [], lspProfiles: [] });
    const builtinTools = tools.filter((t) => t.kind === 'builtin');

    expect(builtinTools.length).toBe(5);

    // Permission-kind approval categories
    expect(builtinTools.some((t) => t.id === 'read')).toBe(true);
    expect(builtinTools.some((t) => t.id === 'write')).toBe(true);
    expect(builtinTools.some((t) => t.id === 'shell')).toBe(true);
    expect(builtinTools.some((t) => t.id === 'web_fetch')).toBe(true);
    expect(builtinTools.some((t) => t.id === 'store_memory')).toBe(true);

    // Labels should be human-readable, not raw IDs
    const readTool = builtinTools.find((t) => t.id === 'read');
    expect(readTool?.label).toBe('Read files');
    const writeTool = builtinTools.find((t) => t.id === 'write');
    expect(writeTool?.label).toBe('Write files');
    const shellTool = builtinTools.find((t) => t.id === 'shell');
    expect(shellTool?.label).toBe('Shell commands');

    // Individual tools should NOT appear in the approval list
    expect(builtinTools.some((t) => t.id === 'bash')).toBe(false);
    expect(builtinTools.some((t) => t.id === 'view')).toBe(false);
    expect(builtinTools.some((t) => t.id === 'edit')).toBe(false);
    expect(builtinTools.some((t) => t.id === 'grep')).toBe(false);
    expect(builtinTools.some((t) => t.id === 'task')).toBe(false);
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

describe('groupApprovalToolsByProvider', () => {
  const TIMESTAMP = '2026-03-28T00:00:00.000Z';

  function makeTooling(
    mcpServers: McpServerDefinition[] = [],
    lspProfiles: LspProfileDefinition[] = [],
  ): WorkspaceToolingSettings {
    return { mcpServers, lspProfiles };
  }

  function makeMcpServer(id: string, name: string, tools: string[]): McpServerDefinition {
    return { id, name, transport: 'local', command: 'node', args: [], tools, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
  }

  function makeLspProfile(id: string, name: string): LspProfileDefinition {
    return { id, name, command: 'lsp-server', args: ['--stdio'], languageId: 'typescript', fileExtensions: ['.ts'], createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
  }

  test('groups MCP tools by server', () => {
    const tooling = makeTooling([
      makeMcpServer('git', 'Git MCP', ['git.status', 'git.diff']),
      makeMcpServer('fs', 'Filesystem', ['fs.read', 'fs.write']),
    ]);
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const mcpGroups = groups.filter((g) => g.kind === 'mcp');
    expect(mcpGroups.length).toBe(2);

    const fsGroup = mcpGroups.find((g) => g.label === 'Filesystem');
    expect(fsGroup).toBeDefined();
    expect(fsGroup!.tools.map((t) => t.id).sort()).toEqual(['fs.read', 'fs.write']);

    const gitGroup = mcpGroups.find((g) => g.label === 'Git MCP');
    expect(gitGroup).toBeDefined();
    expect(gitGroup!.tools.map((t) => t.id).sort()).toEqual(['git.diff', 'git.status']);
  });

  test('groups LSP tools by profile', () => {
    const tooling = makeTooling([], [makeLspProfile('ts', 'TypeScript')]);
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const lspGroups = groups.filter((g) => g.kind === 'lsp');
    expect(lspGroups.length).toBe(1);
    expect(lspGroups[0].label).toBe('TypeScript');
    expect(lspGroups[0].tools.length).toBe(5);
  });

  test('keeps builtins in one group', () => {
    const tooling = makeTooling();
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const builtinGroups = groups.filter((g) => g.kind === 'builtin');
    expect(builtinGroups.length).toBe(1);
    expect(builtinGroups[0].label).toBe('Built-in');
    expect(builtinGroups[0].tools.length).toBe(5);
  });

  test('multi-provider tools go into first provider group, second provider gets empty group', () => {
    const tooling = makeTooling([
      makeMcpServer('git-a', 'Git A', ['git.status']),
      makeMcpServer('git-b', 'Git B', ['git.status']),
    ]);
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const mcpGroups = groups.filter((g) => g.kind === 'mcp');
    expect(mcpGroups.length).toBe(2);
    const gitA = mcpGroups.find((g) => g.label === 'Git A');
    expect(gitA).toBeDefined();
    expect(gitA!.tools[0].providerNames).toEqual(['Git A', 'Git B']);
    const gitB = mcpGroups.find((g) => g.label === 'Git B');
    expect(gitB).toBeDefined();
    expect(gitB!.tools.length).toBe(0);
  });

  test('sorts builtin first, then MCP by name, then LSP by name', () => {
    const tooling = makeTooling(
      [makeMcpServer('z', 'Zebra', ['z.tool']), makeMcpServer('a', 'Alpha', ['a.tool'])],
      [makeLspProfile('ts', 'TypeScript')],
    );
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const kindOrder = groups.map((g) => g.kind);
    expect(kindOrder[0]).toBe('builtin');
    const mcpIdx = kindOrder.indexOf('mcp');
    const lspIdx = kindOrder.indexOf('lsp');
    expect(mcpIdx).toBeLessThan(lspIdx);

    const mcpLabels = groups.filter((g) => g.kind === 'mcp').map((g) => g.label);
    expect(mcpLabels).toEqual(['Alpha', 'Zebra']);
  });

  test('creates groups with serverApprovalKey for MCP servers', () => {
    const tooling = makeTooling([
      makeMcpServer('git', 'Git MCP', ['git.status']),
    ]);
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const mcpGroup = groups.find((g) => g.kind === 'mcp');
    expect(mcpGroup).toBeDefined();
    expect(mcpGroup!.serverApprovalKey).toBe('mcp_server:Git MCP');
  });

  test('creates groups for MCP servers with empty tools array', () => {
    const tooling = makeTooling([
      makeMcpServer('empty', 'Empty Server', []),
    ]);
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const mcpGroups = groups.filter((g) => g.kind === 'mcp');
    expect(mcpGroups.length).toBe(1);
    expect(mcpGroups[0].label).toBe('Empty Server');
    expect(mcpGroups[0].tools.length).toBe(0);
    expect(mcpGroups[0].serverApprovalKey).toBe('mcp_server:Empty Server');
  });

  test('builtin groups do not have serverApprovalKey', () => {
    const tooling = makeTooling();
    const tools = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(tools, tooling);

    const builtinGroup = groups.find((g) => g.kind === 'builtin');
    expect(builtinGroup!.serverApprovalKey).toBeUndefined();
  });
});

describe('server-level approval keys', () => {
  test('buildMcpServerApprovalKey produces mcp_server: prefixed key', () => {
    expect(buildMcpServerApprovalKey('My Server')).toBe('mcp_server:My Server');
    expect(buildMcpServerApprovalKey('git')).toBe('mcp_server:git');
  });

  test('listApprovalToolNames includes server-level keys', () => {
    const tooling: WorkspaceToolingSettings = {
      mcpServers: [{
        id: 'git', name: 'Git MCP', transport: 'local', command: 'node', args: [],
        tools: [], createdAt: '2026-03-28T00:00:00.000Z', updatedAt: '2026-03-28T00:00:00.000Z',
      }],
      lspProfiles: [],
    };
    const names = listApprovalToolNames(tooling);
    expect(names).toContain('mcp_server:Git MCP');
    // Also includes builtins
    expect(names).toContain('read');
    expect(names).toContain('shell');
  });
});

describe('probed tools', () => {
  const TS = '2026-03-28T00:00:00.000Z';

  function makeTooling(mcpServers: McpServerDefinition[] = []): WorkspaceToolingSettings {
    return { mcpServers, lspProfiles: [] };
  }

  test('listApprovalToolDefinitions uses probedTools when tools array is empty', () => {
    const tooling = makeTooling([{
      id: 'mcp-1', name: 'Probed Server', transport: 'local', command: 'node', args: [],
      tools: [],
      probedTools: [
        { name: 'search', description: 'Search files' },
        { name: 'index', description: 'Build index' },
      ],
      createdAt: TS, updatedAt: TS,
    }]);
    const defs = listApprovalToolDefinitions(tooling);
    const mcpDefs = defs.filter((d) => d.kind === 'mcp');
    expect(mcpDefs.length).toBe(2);
    expect(mcpDefs.map((d) => d.id).sort()).toEqual(['index', 'search']);
    expect(mcpDefs[0].providerNames).toContain('Probed Server');
  });

  test('listApprovalToolDefinitions prefers declared tools over probedTools', () => {
    const tooling = makeTooling([{
      id: 'mcp-2', name: 'Declared Server', transport: 'local', command: 'node', args: [],
      tools: ['read_file', 'write_file'],
      probedTools: [
        { name: 'read_file' },
        { name: 'write_file' },
        { name: 'delete_file' },
      ],
      createdAt: TS, updatedAt: TS,
    }]);
    const defs = listApprovalToolDefinitions(tooling);
    const mcpDefs = defs.filter((d) => d.kind === 'mcp');
    expect(mcpDefs.length).toBe(2);
    expect(mcpDefs.map((d) => d.id).sort()).toEqual(['read_file', 'write_file']);
  });

  test('listApprovalToolDefinitions returns no MCP tools when both tools and probedTools are empty', () => {
    const tooling = makeTooling([{
      id: 'mcp-3', name: 'Empty Server', transport: 'local', command: 'node', args: [],
      tools: [],
      probedTools: [],
      createdAt: TS, updatedAt: TS,
    }]);
    const defs = listApprovalToolDefinitions(tooling);
    const mcpDefs = defs.filter((d) => d.kind === 'mcp');
    expect(mcpDefs.length).toBe(0);
  });

  test('listApprovalToolDefinitions handles undefined probedTools gracefully', () => {
    const tooling = makeTooling([{
      id: 'mcp-4', name: 'No Probe Server', transport: 'local', command: 'node', args: [],
      tools: [],
      createdAt: TS, updatedAt: TS,
    }]);
    const defs = listApprovalToolDefinitions(tooling);
    const mcpDefs = defs.filter((d) => d.kind === 'mcp');
    expect(mcpDefs.length).toBe(0);
  });

  test('probed tools with blank names are filtered out', () => {
    const tooling = makeTooling([{
      id: 'mcp-5', name: 'Blank Tools', transport: 'local', command: 'node', args: [],
      tools: [],
      probedTools: [
        { name: 'valid_tool' },
        { name: '  ' },
        { name: '' },
      ],
      createdAt: TS, updatedAt: TS,
    }]);
    const defs = listApprovalToolDefinitions(tooling);
    const mcpDefs = defs.filter((d) => d.kind === 'mcp');
    expect(mcpDefs.length).toBe(1);
    expect(mcpDefs[0].id).toBe('valid_tool');
  });

  test('groupApprovalToolsByProvider shows probed tools in MCP group', () => {
    const tooling = makeTooling([{
      id: 'mcp-6', name: 'Probed MCP', transport: 'local', command: 'node', args: [],
      tools: [],
      probedTools: [
        { name: 'tool_a', description: 'Tool A desc' },
        { name: 'tool_b' },
      ],
      createdAt: TS, updatedAt: TS,
    }]);
    const defs = listApprovalToolDefinitions(tooling);
    const groups = groupApprovalToolsByProvider(defs, tooling);
    const mcpGroup = groups.find((g) => g.kind === 'mcp' && g.label === 'Probed MCP');
    expect(mcpGroup).toBeDefined();
    expect(mcpGroup!.tools.length).toBe(2);
    expect(mcpGroup!.serverApprovalKey).toBe('mcp_server:Probed MCP');
  });

  test('listApprovalToolNames includes probed tool names', () => {
    const tooling = makeTooling([{
      id: 'mcp-7', name: 'Probed Keys', transport: 'local', command: 'node', args: [],
      tools: [],
      probedTools: [{ name: 'probe_tool_1' }, { name: 'probe_tool_2' }],
      createdAt: TS, updatedAt: TS,
    }]);
    const names = listApprovalToolNames(tooling);
    expect(names).toContain('probe_tool_1');
    expect(names).toContain('probe_tool_2');
    expect(names).toContain('mcp_server:Probed Keys');
  });
});
