import type {
  RunTurnLspProfileConfig,
  RunTurnMcpServerConfig,
  RunTurnToolingConfig,
} from '@shared/contracts/sidecar';
import type {
  LspProfileDefinition,
  McpServerDefinition,
  SessionToolingSelection,
  WorkspaceToolingSettings,
} from '@shared/domain/tooling';

export function validateSessionToolingSelectionIds(
  tooling: WorkspaceToolingSettings,
  selection: SessionToolingSelection,
): void {
  const knownMcpServerIds = new Set(tooling.mcpServers.map((server) => server.id));
  const unknownMcpServerIds = selection.enabledMcpServerIds.filter((id) => !knownMcpServerIds.has(id));
  if (unknownMcpServerIds.length > 0) {
    throw new Error(`Unknown MCP server "${unknownMcpServerIds[0]}".`);
  }

  const knownLspProfileIds = new Set(tooling.lspProfiles.map((profile) => profile.id));
  const unknownLspProfileIds = selection.enabledLspProfileIds.filter((id) => !knownLspProfileIds.has(id));
  if (unknownLspProfileIds.length > 0) {
    throw new Error(`Unknown LSP profile "${unknownLspProfileIds[0]}".`);
  }
}

export function buildRunTurnToolingConfig(
  tooling: WorkspaceToolingSettings,
  selection: SessionToolingSelection,
): RunTurnToolingConfig | undefined {
  const mcpServersById = new Map<string, McpServerDefinition>(
    tooling.mcpServers.map((server) => [server.id, server]),
  );
  const lspProfilesById = new Map<string, LspProfileDefinition>(
    tooling.lspProfiles.map((profile) => [profile.id, profile]),
  );

  const mcpServers = selection.enabledMcpServerIds.flatMap((id): RunTurnMcpServerConfig[] => {
    const server = mcpServersById.get(id);
    if (!server) {
      return [];
    }

    if (server.transport === 'local') {
      return [
        {
          id: server.id,
          name: server.name,
          transport: 'local',
          tools: [...server.tools],
          timeoutMs: server.timeoutMs,
          command: server.command,
          args: [...server.args],
          cwd: server.cwd,
        },
      ];
    }

    return [
      {
        id: server.id,
        name: server.name,
        transport: server.transport,
        tools: [...server.tools],
        timeoutMs: server.timeoutMs,
        url: server.url,
      },
    ];
  });

  const lspProfiles = selection.enabledLspProfileIds.flatMap((id): RunTurnLspProfileConfig[] => {
    const profile = lspProfilesById.get(id);
    if (!profile) {
      return [];
    }

    return [
      {
        id: profile.id,
        name: profile.name,
        command: profile.command,
        args: [...profile.args],
        languageId: profile.languageId,
        fileExtensions: [...profile.fileExtensions],
      },
    ];
  });

  if (mcpServers.length === 0 && lspProfiles.length === 0) {
    return undefined;
  }

  return {
    mcpServers,
    lspProfiles,
  };
}
