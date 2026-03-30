import {
  createDiscoveredToolingState,
  listAcceptedDiscoveredMcpServers,
  normalizeDiscoveredToolingState,
  type DiscoveredToolingState,
  type ProjectDiscoveredTooling,
} from '@shared/domain/discoveredTooling';
import { nowIso } from '@shared/utils/ids';

export type McpServerTransport = 'local' | 'http' | 'sse';

export interface McpProbedTool {
  name: string;
  description?: string;
}

export interface BaseMcpServerDefinition {
  id: string;
  name: string;
  transport: McpServerTransport;
  tools: string[];
  probedTools?: McpProbedTool[];
  timeoutMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMcpServerDefinition extends BaseMcpServerDefinition {
  transport: 'local';
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface RemoteMcpServerDefinition extends BaseMcpServerDefinition {
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
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
  discoveredUserTooling: DiscoveredToolingState;
  terminalHeight?: number;
  notificationsEnabled?: boolean;
  minimizeToTray?: boolean;
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

// Human-readable labels for built-in runtime tools.
// Both bash and powershell variants are included for forward compatibility.
const builtinToolLabels: ReadonlyMap<string, string> = new Map([
  // Permission-kind approval categories (used by sidecar for runtime tool session approval)
  ['shell', 'Shell commands'],
  ['read', 'Read files'],
  ['write', 'Write files'],
  // Shell tools
  ['bash', 'Execute shell commands'],
  ['powershell', 'Execute shell commands'],
  ['read_bash', 'Read shell output'],
  ['read_powershell', 'Read shell output'],
  ['write_bash', 'Write shell input'],
  ['write_powershell', 'Write shell input'],
  ['stop_bash', 'Stop shell session'],
  ['stop_powershell', 'Stop shell session'],
  ['list_bash', 'List shell sessions'],
  ['list_powershell', 'List shell sessions'],
  // File tools
  ['view', 'View files'],
  ['create', 'Create files'],
  ['edit', 'Edit files'],
  ['apply_patch', 'Apply patch'],
  // Search tools
  ['grep', 'Search file contents'],
  ['rg', 'Search file contents'],
  ['glob', 'Find files by pattern'],
  // Agent tools
  ['task', 'Run sub-agent'],
  ['read_agent', 'Read agent results'],
  ['list_agents', 'List agents'],
  // Web tools
  ['web_fetch', 'Fetch web content'],
  ['web_search', 'Search the web'],
  // Other tools
  ['skill', 'Invoke skill'],
  ['show_file', 'Show file'],
  ['fetch_copilot_cli_documentation', 'Fetch CLI docs'],
  ['update_todo', 'Update checklist'],
  ['store_memory', 'Store memory'],
  ['sql', 'Query session data'],
  ['lsp', 'Language server'],
]);

export function resolveToolLabel(toolId: string): string {
  return builtinToolLabels.get(toolId) ?? toolId;
}

// Fallback approval tool categories for runtime tools. The approval UI groups
// built-in tools by permission category (read, write, shell, web, memory) rather
// than listing 20+ individual tools, matching other coding agents (Copilot CLI,
// Cline, Roo Code, etc.).
const fallbackRuntimeApprovalTools: ReadonlyArray<RuntimeToolDefinition> = [
  { id: 'read', label: 'Read files' },
  { id: 'write', label: 'Write files' },
  { id: 'shell', label: 'Shell commands' },
  { id: 'web_fetch', label: 'Web access' },
  { id: 'store_memory', label: 'Store memory' },
];

const MCP_SERVER_APPROVAL_PREFIX = 'mcp_server:';

export function buildMcpServerApprovalKey(serverName: string): string {
  return `${MCP_SERVER_APPROVAL_PREFIX}${serverName}`;
}

export function createWorkspaceSettings(): WorkspaceSettings {
  return {
    theme: 'dark',
    tooling: {
      mcpServers: [],
      lspProfiles: [],
    },
    discoveredUserTooling: createDiscoveredToolingState(),
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

export function normalizeTerminalHeight(value?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.round(value);
  return normalized >= 120 ? normalized : undefined;
}

export function normalizeWorkspaceSettings(settings?: Partial<WorkspaceSettings>): WorkspaceSettings {
  const terminalHeight = normalizeTerminalHeight(settings?.terminalHeight);
  return {
    theme: normalizeTheme(settings?.theme),
    tooling: {
      mcpServers: (settings?.tooling?.mcpServers ?? []).map(normalizeMcpServerDefinition),
      lspProfiles: (settings?.tooling?.lspProfiles ?? []).map(normalizeLspProfileDefinition),
    },
    discoveredUserTooling: normalizeDiscoveredToolingState(settings?.discoveredUserTooling),
    ...(terminalHeight !== undefined ? { terminalHeight } : {}),
    ...(settings?.notificationsEnabled !== undefined ? { notificationsEnabled: settings.notificationsEnabled } : {}),
    ...(settings?.minimizeToTray !== undefined ? { minimizeToTray: settings.minimizeToTray } : {}),
  };
}

export function resolveWorkspaceToolingSettings(settings: WorkspaceSettings): WorkspaceToolingSettings {
  return mergeAcceptedDiscoveredMcpServers(
    {
      mcpServers: settings.tooling.mcpServers.map((server) => ({ ...server })),
      lspProfiles: settings.tooling.lspProfiles.map((profile) => ({ ...profile })),
    },
    settings.discoveredUserTooling,
  );
}

export function resolveProjectToolingSettings(
  settings: WorkspaceSettings,
  projectDiscoveredTooling?: ProjectDiscoveredTooling,
): WorkspaceToolingSettings {
  return mergeAcceptedDiscoveredMcpServers(resolveWorkspaceToolingSettings(settings), projectDiscoveredTooling);
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
  _runtimeTools: ReadonlyArray<RuntimeToolDefinition> = fallbackRuntimeApprovalTools,
): ApprovalToolDefinition[] {
  const toolsById = new Map<string, ApprovalToolDefinition>();

  // Always use category-level approval for built-in runtime tools regardless of
  // what the sidecar reports as individual tools.
  for (const tool of fallbackRuntimeApprovalTools) {
    registerApprovalTool(toolsById, {
      id: tool.id,
      label: resolveToolLabel(tool.id),
      description: tool.description,
      kind: 'builtin',
      providerId: `builtin:${tool.id}`,
      providerName: 'Built-in',
    });
  }

  for (const server of tooling.mcpServers) {
    const declaredTools = normalizeStringArray(server.tools);
    const toolEntries = declaredTools.length > 0
      ? declaredTools.map((name) => ({ name, description: undefined }))
      : (server.probedTools ?? []).filter((t) => t.name.trim().length > 0);

    for (const tool of toolEntries) {
      registerApprovalTool(toolsById, {
        id: tool.name,
        label: tool.name,
        description: tool.description,
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
  const toolNames = listApprovalToolDefinitions(tooling, runtimeTools).map((tool) => tool.id);
  for (const server of tooling.mcpServers) {
    toolNames.push(buildMcpServerApprovalKey(server.name));
  }
  return [...new Set(toolNames)];
}

export interface ApprovalToolGroup {
  id: string;
  label: string;
  kind: ApprovalToolKind;
  tools: ApprovalToolDefinition[];
  serverApprovalKey?: string;
}

const approvalToolGroupKindOrder: ApprovalToolKind[] = ['builtin', 'mcp', 'lsp', 'mixed'];

export function groupApprovalToolsByProvider(
  tools: ReadonlyArray<ApprovalToolDefinition>,
  tooling: WorkspaceToolingSettings,
): ApprovalToolGroup[] {
  const serverNames = new Map(tooling.mcpServers.map((s) => [s.id, s.name]));
  const profileNames = new Map(tooling.lspProfiles.map((p) => [p.id, p.name]));
  const groups = new Map<string, ApprovalToolGroup>();

  for (const tool of tools) {
    // Place MCP tools in every provider group they belong to, so each server
    // shows its own tools even when multiple servers share the same tool names.
    if (tool.kind === 'mcp' && tool.providerIds.length > 1) {
      for (const providerId of tool.providerIds) {
        const groupId = `mcp:${providerId}`;
        let group = groups.get(groupId);
        if (!group) {
          const label = serverNames.get(providerId) ?? providerId;
          group = { id: groupId, label, kind: 'mcp', tools: [] };
          groups.set(groupId, group);
        }
        group.tools.push(tool);
      }
      continue;
    }

    const groupKey = resolveApprovalToolGroupKey(tool, serverNames, profileNames);
    let group = groups.get(groupKey.id);
    if (!group) {
      group = { id: groupKey.id, label: groupKey.label, kind: groupKey.kind, tools: [] };
      groups.set(groupKey.id, group);
    }
    group.tools.push(tool);
  }

  // Ensure every MCP server has a group (even with no declared tools) and
  // attach server-level approval keys.
  for (const server of tooling.mcpServers) {
    const groupId = `mcp:${server.id}`;
    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, label: server.name, kind: 'mcp', tools: [] };
      groups.set(groupId, group);
    }
    group.serverApprovalKey = buildMcpServerApprovalKey(server.name);
  }

  return [...groups.values()].sort((a, b) => {
    const kindDiff = approvalToolGroupKindOrder.indexOf(a.kind) - approvalToolGroupKindOrder.indexOf(b.kind);
    if (kindDiff !== 0) return kindDiff;
    return a.label.localeCompare(b.label);
  });
}

function resolveApprovalToolGroupKey(
  tool: ApprovalToolDefinition,
  serverNames: ReadonlyMap<string, string>,
  profileNames: ReadonlyMap<string, string>,
): { id: string; label: string; kind: ApprovalToolKind } {
  if (tool.kind === 'builtin') {
    return { id: 'builtin', label: 'Built-in', kind: 'builtin' };
  }

  const primaryProviderId = tool.providerIds[0];
  if (tool.kind === 'mcp' && primaryProviderId) {
    return {
      id: `mcp:${primaryProviderId}`,
      label: serverNames.get(primaryProviderId) ?? tool.providerNames[0] ?? primaryProviderId,
      kind: 'mcp',
    };
  }

  if (tool.kind === 'lsp' && primaryProviderId) {
    return {
      id: `lsp:${primaryProviderId}`,
      label: profileNames.get(primaryProviderId) ?? tool.providerNames[0] ?? primaryProviderId,
      kind: 'lsp',
    };
  }

  return { id: 'other', label: 'Other', kind: 'mixed' };
}

/**
 * Count how many tools are effectively auto-approved across all groups.
 *
 * This must use per-group counting (not unique-tool-ID deduplication) to stay
 * consistent with the total-item formula used in InlineApprovalPill, which
 * counts each group occurrence independently.  Without this, shared tool names
 * across MCP servers produce a numerator smaller than the denominator even when
 * everything is approved.
 */
export function countApprovedToolsInGroups(
  groups: ReadonlyArray<ApprovalToolGroup>,
  approved: ReadonlySet<string>,
): number {
  let count = 0;
  for (const group of groups) {
    if (group.serverApprovalKey && approved.has(group.serverApprovalKey)) {
      // Server-level approval covers all tools.  Servers with 0 tools still
      // count as 1 (matching the totalItemCount formula).
      count += Math.max(group.tools.length, 1);
    } else {
      for (const tool of group.tools) {
        if (approved.has(tool.id)) count += 1;
      }
    }
  }
  return count;
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
      env: normalizeStringRecord(server.env),
    };
  }

  return {
    ...base,
    transport: server.transport,
    url: server.url.trim(),
    headers: normalizeStringRecord(server.headers),
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

function mergeAcceptedDiscoveredMcpServers(
  tooling: WorkspaceToolingSettings,
  discoveredTooling?: DiscoveredToolingState,
): WorkspaceToolingSettings {
  const discoveredMcpServers = listAcceptedDiscoveredMcpServers(discoveredTooling).map((server) =>
    toResolvedMcpServerDefinition(server, discoveredTooling?.lastScannedAt),
  );

  if (discoveredMcpServers.length === 0) {
    return tooling;
  }

  return {
    mcpServers: [...tooling.mcpServers, ...discoveredMcpServers],
    lspProfiles: [...tooling.lspProfiles],
  };
}

function toResolvedMcpServerDefinition(
  server: ReturnType<typeof listAcceptedDiscoveredMcpServers>[number],
  timestamp = nowIso(),
): McpServerDefinition {
  const probedTools = server.probedTools && server.probedTools.length > 0
    ? [...server.probedTools]
    : undefined;

  if (server.transport === 'local') {
    return normalizeMcpServerDefinition({
      id: server.id,
      name: server.name,
      transport: 'local',
      command: server.command,
      args: [...server.args],
      cwd: server.cwd,
      env: server.env ? { ...server.env } : undefined,
      tools: [...server.tools],
      probedTools,
      timeoutMs: server.timeoutMs,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return normalizeMcpServerDefinition({
    id: server.id,
    name: server.name,
    transport: server.transport,
    url: server.url,
    headers: server.headers ? { ...server.headers } : undefined,
    tools: [...server.tools],
    probedTools,
    timeoutMs: server.timeoutMs,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
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

function normalizeStringRecord(record?: Record<string, string>): Record<string, string> | undefined {
  if (!record) {
    return undefined;
  }

  const normalizedEntries = Object.entries(record)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}
