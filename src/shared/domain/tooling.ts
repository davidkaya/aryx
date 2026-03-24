export type McpServerTransport = 'local' | 'http' | 'sse';

export interface BaseMcpServerDefinition {
  id: string;
  name: string;
  transport: McpServerTransport;
  tools: string[];
  timeoutMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMcpServerDefinition extends BaseMcpServerDefinition {
  transport: 'local';
  command: string;
  args: string[];
  cwd?: string;
}

export interface RemoteMcpServerDefinition extends BaseMcpServerDefinition {
  transport: 'http' | 'sse';
  url: string;
}

export type McpServerDefinition = LocalMcpServerDefinition | RemoteMcpServerDefinition;

export interface LspProfileDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
  languageId: string;
  fileExtensions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceToolingSettings {
  mcpServers: McpServerDefinition[];
  lspProfiles: LspProfileDefinition[];
}

export type AppearanceTheme = 'dark' | 'light' | 'system';

export interface WorkspaceSettings {
  theme: AppearanceTheme;
  tooling: WorkspaceToolingSettings;
}

export interface SessionToolingSelection {
  enabledMcpServerIds: string[];
  enabledLspProfileIds: string[];
}

export type ApprovalToolKind = 'builtin' | 'mcp' | 'lsp' | 'mixed';

export interface RuntimeToolDefinition {
  id: string;
  label: string;
  description?: string;
}

export interface ApprovalToolDefinition {
  id: string;
  label: string;
  kind: ApprovalToolKind;
  providerIds: string[];
  providerNames: string[];
  description?: string;
}

const lspApprovalOperations = [
  { suffix: 'workspace_symbols', label: 'Workspace symbols' },
  { suffix: 'document_symbols', label: 'Document symbols' },
  { suffix: 'definition', label: 'Definition' },
  { suffix: 'hover', label: 'Hover' },
  { suffix: 'references', label: 'References' },
] as const;

// Fallback runtime tools used before sidecar capabilities are loaded or when the
// CLI cannot report its built-in tool catalog dynamically.
const fallbackRuntimeApprovalTools: ReadonlyArray<RuntimeToolDefinition> = [
  { id: 'glob', label: 'glob', description: 'Match files by glob pattern.' },
  { id: 'lsp', label: 'lsp', description: 'Query configured language servers.' },
  { id: 'rg', label: 'rg', description: 'Search file contents with ripgrep.' },
  { id: 'view', label: 'view', description: 'Read files and list directories.' },
  { id: 'web_fetch', label: 'web_fetch', description: 'Fetch content from a URL.' },
  { id: 'web_search', label: 'web_search', description: 'Search the web for current information.' },
];

export function createWorkspaceSettings(): WorkspaceSettings {
  return {
    theme: 'dark',
    tooling: {
      mcpServers: [],
      lspProfiles: [],
    },
  };
}

export function createSessionToolingSelection(): SessionToolingSelection {
  return {
    enabledMcpServerIds: [],
    enabledLspProfileIds: [],
  };
}

const validThemes: ReadonlySet<string> = new Set<AppearanceTheme>(['dark', 'light', 'system']);

export function normalizeTheme(value?: string): AppearanceTheme {
  return validThemes.has(value ?? '') ? (value as AppearanceTheme) : 'dark';
}

export function normalizeWorkspaceSettings(settings?: Partial<WorkspaceSettings>): WorkspaceSettings {
  return {
    theme: normalizeTheme(settings?.theme),
    tooling: {
      mcpServers: (settings?.tooling?.mcpServers ?? []).map(normalizeMcpServerDefinition),
      lspProfiles: (settings?.tooling?.lspProfiles ?? []).map(normalizeLspProfileDefinition),
    },
  };
}

export function normalizeSessionToolingSelection(
  selection?: Partial<SessionToolingSelection>,
): SessionToolingSelection {
  return {
    enabledMcpServerIds: normalizeStringArray(selection?.enabledMcpServerIds),
    enabledLspProfileIds: normalizeStringArray(selection?.enabledLspProfileIds),
  };
}

export function listApprovalToolDefinitions(
  tooling: WorkspaceToolingSettings,
  runtimeTools: ReadonlyArray<RuntimeToolDefinition> = fallbackRuntimeApprovalTools,
): ApprovalToolDefinition[] {
  const toolsById = new Map<string, ApprovalToolDefinition>();
  const runtimeApprovalTools = runtimeTools.length > 0 ? runtimeTools : fallbackRuntimeApprovalTools;

  for (const tool of runtimeApprovalTools) {
    registerApprovalTool(toolsById, {
      id: tool.id,
      label: tool.label,
      description: tool.description,
      kind: 'builtin',
      providerId: `builtin:${tool.id}`,
      providerName: 'Built-in',
    });
  }

  for (const server of tooling.mcpServers) {
    for (const toolName of normalizeStringArray(server.tools)) {
      registerApprovalTool(toolsById, {
        id: toolName,
        label: toolName,
        kind: 'mcp',
        providerId: server.id,
        providerName: server.name,
      });
    }
  }

  for (const profile of tooling.lspProfiles) {
    const toolPrefix = buildLspApprovalToolPrefix(profile.id);
    for (const operation of lspApprovalOperations) {
      registerApprovalTool(toolsById, {
        id: `${toolPrefix}_${operation.suffix}`,
        label: `${profile.name} · ${operation.label}`,
        kind: 'lsp',
        providerId: profile.id,
        providerName: profile.name,
      });
    }
  }

  return [...toolsById.values()].sort((left, right) =>
    left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function listApprovalToolNames(
  tooling: WorkspaceToolingSettings,
  runtimeTools?: ReadonlyArray<RuntimeToolDefinition>,
): string[] {
  return listApprovalToolDefinitions(tooling, runtimeTools).map((tool) => tool.id);
}

export function validateMcpServerDefinition(server: McpServerDefinition): string | undefined {
  if (!server.name.trim()) {
    return 'MCP server name is required.';
  }

  if (server.transport === 'local') {
    if (!server.command.trim()) {
      return `MCP server "${server.name}" needs a command.`;
    }

    return undefined;
  }

  if (!server.url.trim()) {
    return `MCP server "${server.name}" needs a URL.`;
  }

  try {
    new URL(server.url);
  } catch {
    return `MCP server "${server.name}" has an invalid URL.`;
  }

  return undefined;
}

export function validateLspProfileDefinition(profile: LspProfileDefinition): string | undefined {
  if (!profile.name.trim()) {
    return 'LSP profile name is required.';
  }

  if (!profile.command.trim()) {
    return `LSP profile "${profile.name}" needs a command.`;
  }

  if (!profile.languageId.trim()) {
    return `LSP profile "${profile.name}" needs a language ID.`;
  }

  if (normalizeStringArray(profile.fileExtensions).length === 0) {
    return `LSP profile "${profile.name}" needs at least one file extension.`;
  }

  if (requiresTypeScriptLanguageServerStdio(profile.command)
    && !normalizeStringArray(profile.args).some((arg) => arg.toLowerCase() === '--stdio')) {
    return `LSP profile "${profile.name}" needs the "--stdio" argument.`;
  }

  return undefined;
}

export function normalizeMcpServerDefinition(server: McpServerDefinition): McpServerDefinition {
  const base = {
    ...server,
    name: server.name.trim(),
    tools: normalizeStringArray(server.tools),
  };

  if (server.transport === 'local') {
    return {
      ...base,
      transport: 'local',
      command: server.command.trim(),
      args: normalizeStringArray(server.args),
      cwd: server.cwd?.trim() || undefined,
    };
  }

  return {
    ...base,
    transport: server.transport,
    url: server.url.trim(),
  };
}

export function normalizeLspProfileDefinition(profile: LspProfileDefinition): LspProfileDefinition {
  return {
    ...profile,
    name: profile.name.trim(),
    command: profile.command.trim(),
    args: normalizeStringArray(profile.args),
    languageId: profile.languageId.trim(),
    fileExtensions: normalizeFileExtensions(profile.fileExtensions),
  };
}

function normalizeFileExtensions(fileExtensions: string[]): string[] {
  return normalizeStringArray(fileExtensions).map((value) => (value.startsWith('.') ? value : `.${value}`));
}

function requiresTypeScriptLanguageServerStdio(command: string): boolean {
  const executableName = command
    .trim()
    .split(/[\\/]/)
    .at(-1)
    ?.toLowerCase();

  return executableName === 'typescript-language-server'
    || executableName === 'typescript-language-server.cmd'
    || executableName === 'typescript-language-server.exe';
}

function buildLspApprovalToolPrefix(value: string): string {
  let prefix = '';
  for (const char of value) {
    if (/[a-z0-9]/i.test(char)) {
      prefix += char.toLowerCase();
      continue;
    }

    if (!prefix || prefix.endsWith('_')) {
      continue;
    }

    prefix += '_';
  }

  const normalized = prefix.replace(/^_+|_+$/g, '');
  return normalized ? `lsp_${normalized}` : 'lsp';
}

function registerApprovalTool(
  toolsById: Map<string, ApprovalToolDefinition>,
  tool: {
    id: string;
    label: string;
    description?: string;
    kind: Exclude<ApprovalToolKind, 'mixed'>;
    providerId: string;
    providerName: string;
  },
): void {
  const existing = toolsById.get(tool.id);
  if (!existing) {
    toolsById.set(tool.id, {
      id: tool.id,
      label: tool.label,
      description: tool.description,
      kind: tool.kind,
      providerIds: [tool.providerId],
      providerNames: [tool.providerName],
    });
    return;
  }

  if (!existing.providerIds.includes(tool.providerId)) {
    existing.providerIds.push(tool.providerId);
  }
  if (!existing.providerNames.includes(tool.providerName)) {
    existing.providerNames.push(tool.providerName);
  }
  if (!existing.description && tool.description) {
    existing.description = tool.description;
  }
  if (existing.kind !== tool.kind) {
    existing.kind = 'mixed';
  }
}

function normalizeStringArray(values?: ReadonlyArray<string>): string[] {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
