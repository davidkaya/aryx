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

export interface WorkspaceSettings {
  tooling: WorkspaceToolingSettings;
}

export interface SessionToolingSelection {
  enabledMcpServerIds: string[];
  enabledLspProfileIds: string[];
}

export function createWorkspaceSettings(): WorkspaceSettings {
  return {
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

export function normalizeWorkspaceSettings(settings?: Partial<WorkspaceSettings>): WorkspaceSettings {
  return {
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

function normalizeStringArray(values?: ReadonlyArray<string>): string[] {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
