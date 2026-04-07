import type { SessionToolingSelection, WorkspaceToolingSettings, McpServerDefinition } from '@shared/domain/tooling';
import {
  listAcceptedDiscoveredMcpServers,
  type DiscoveredMcpServer,
  type DiscoveredToolingState,
} from '@shared/domain/discoveredTooling';
import type { WorkspaceState } from '@shared/domain/workspace';
import { nowIso } from '@shared/utils/ids';

import { probeServers, type McpProbeResult } from '@main/services/mcpToolProber';
import { getStoredToken } from '@main/services/mcpTokenStore';
import { performMcpOAuthFlow, requiresOAuth } from '@main/services/mcpOAuthService';

type McpProbeManagerDeps = {
  loadWorkspace: () => Promise<WorkspaceState>;
  persistWorkspace: (workspace: WorkspaceState) => Promise<void>;
  probeMcpServers?: typeof probeServers;
  tokenLookup?: (serverUrl: string) => string | undefined;
  performMcpOAuthFlow?: typeof performMcpOAuthFlow;
  requiresOAuth?: typeof requiresOAuth;
};

export class McpProbeManager {
  private mcpProbeUpdateQueue = Promise.resolve();

  private readonly loadWorkspace: () => Promise<WorkspaceState>;
  private readonly persistWorkspace: (workspace: WorkspaceState) => Promise<void>;
  private readonly probeMcpServers: typeof probeServers;
  private readonly tokenLookup: (serverUrl: string) => string | undefined;
  private readonly performMcpOAuthFlow: typeof performMcpOAuthFlow;
  private readonly requiresOAuth: typeof requiresOAuth;

  constructor(deps: McpProbeManagerDeps) {
    this.loadWorkspace = deps.loadWorkspace;
    this.persistWorkspace = deps.persistWorkspace;
    this.probeMcpServers = deps.probeMcpServers ?? probeServers;
    this.tokenLookup = deps.tokenLookup ?? ((serverUrl) => getStoredToken(serverUrl)?.accessToken);
    this.performMcpOAuthFlow = deps.performMcpOAuthFlow ?? performMcpOAuthFlow;
    this.requiresOAuth = deps.requiresOAuth ?? requiresOAuth;
  }

  async probeAndAuthenticateHttpMcpServers(
    tooling: WorkspaceToolingSettings,
    selection: SessionToolingSelection,
  ): Promise<void> {
    const httpServers = selection.enabledMcpServerIds
      .map((id) => tooling.mcpServers.find((server) => server.id === id))
      .filter((server): server is McpServerDefinition => !!server && server.transport !== 'local')
      .filter((server) => server.transport === 'http' || server.transport === 'sse');

    if (httpServers.length === 0) {
      return;
    }

    console.log(`[aryx oauth] Probing ${httpServers.length} HTTP MCP server(s) for OAuth requirements…`);

    for (const server of httpServers) {
      if (server.transport === 'local') {
        continue;
      }

      const existingToken = this.tokenLookup(server.url);
      if (existingToken) {
        console.log(`[aryx oauth] Skipping ${server.name} — token already stored`);
        continue;
      }

      try {
        const needsAuth = await this.requiresOAuth(server.url);
        if (!needsAuth) {
          console.log(`[aryx oauth] ${server.name} does not require OAuth`);
          continue;
        }

        console.log(`[aryx oauth] ${server.name} requires OAuth — starting flow…`);
        const result = await this.performMcpOAuthFlow({ serverUrl: server.url });
        if (result.success) {
          console.log(`[aryx oauth] ${server.name} authenticated successfully`);
          void this.reprobeServerByUrl(server.url).catch((error) => {
            console.error('[aryx mcp-probe] re-probe after auth failed:', error);
          });
        } else {
          console.warn(`[aryx oauth] Proactive auth failed for ${server.name}: ${result.error}`);
        }
      } catch (error) {
        console.warn(`[aryx oauth] Proactive auth probe failed for ${server.name}:`, error);
      }
    }
  }

  async probeAllAcceptedMcpServers(workspace: WorkspaceState): Promise<void> {
    const targets = [
      ...this.listAcceptedDiscoveredServerDefinitions(
        workspace,
        (server) => !server.probedTools || server.probedTools.length === 0,
      ),
      ...workspace.settings.tooling.mcpServers.filter(
        (server) => server.tools.length === 0 && (!server.probedTools || server.probedTools.length === 0),
      ),
    ];

    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  async probeDiscoveredMcpServersFromState(
    workspace: WorkspaceState,
    state?: DiscoveredToolingState,
  ): Promise<void> {
    const targets = listAcceptedDiscoveredMcpServers(state)
      .filter((server) => !server.probedTools || server.probedTools.length === 0)
      .map((server) => this.discoveredServerToDefinition(server));
    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  async probeDiscoveredMcpServers(
    workspace: WorkspaceState,
    state: DiscoveredToolingState | undefined,
    serverIds: ReadonlyArray<string>,
  ): Promise<void> {
    const targets = listAcceptedDiscoveredMcpServers(state)
      .filter((server) => serverIds.includes(server.id))
      .map((server) => this.discoveredServerToDefinition(server));
    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  async probeWorkspaceMcpServers(
    workspace: WorkspaceState,
    targets: ReadonlyArray<McpServerDefinition>,
  ): Promise<void> {
    const uniqueTargets = [...new Map(targets.map((server) => [server.id, server])).values()];
    if (uniqueTargets.length === 0) {
      return;
    }

    const targetIds = uniqueTargets.map((server) => server.id);
    await this.enqueueMcpProbeUpdate(async () => {
      if (this.addMcpProbingServerIds(workspace, targetIds)) {
        await this.persistWorkspace(workspace);
      }
    });

    try {
      await this.probeMcpServers(uniqueTargets, this.tokenLookup, (result) =>
        this.enqueueMcpProbeUpdate(async () => {
          const didUpdateProbing = this.removeMcpProbingServerIds(workspace, [result.serverId]);
          const didApplyResult = this.applyMcpProbeResult(workspace, result);
          if (didUpdateProbing || didApplyResult) {
            await this.persistWorkspace(workspace);
          }
        }));
    } finally {
      await this.enqueueMcpProbeUpdate(async () => {
        if (this.removeMcpProbingServerIds(workspace, targetIds)) {
          await this.persistWorkspace(workspace);
        }
      });
    }
  }

  async reprobeServerByUrl(serverUrl: string): Promise<void> {
    const workspace = await this.loadWorkspace();
    const targets: McpServerDefinition[] = [];

    for (const server of workspace.settings.tooling.mcpServers) {
      if (server.transport !== 'local' && server.url === serverUrl) {
        targets.push(server);
      }
    }

    const allDiscovered = [
      ...(workspace.settings.discoveredUserTooling?.mcpServers ?? []),
      ...workspace.projects.flatMap((project) => project.discoveredTooling?.mcpServers ?? []),
    ];

    for (const server of allDiscovered) {
      if (server.status === 'accepted' && server.transport !== 'local' && server.url === serverUrl) {
        targets.push(this.discoveredServerToDefinition(server));
      }
    }

    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  listAcceptedDiscoveredServerDefinitions(
    workspace: WorkspaceState,
    predicate?: (server: DiscoveredMcpServer) => boolean,
  ): McpServerDefinition[] {
    const definitions: McpServerDefinition[] = [];

    for (const state of this.listDiscoveredToolingStates(workspace)) {
      for (const server of listAcceptedDiscoveredMcpServers(state)) {
        if (predicate && !predicate(server)) {
          continue;
        }
        definitions.push(this.discoveredServerToDefinition(server));
      }
    }

    return definitions;
  }

  listDiscoveredToolingStates(workspace: WorkspaceState): Array<DiscoveredToolingState | undefined> {
    return [
      workspace.settings.discoveredUserTooling,
      ...workspace.projects.map((project) => project.discoveredTooling),
    ];
  }

  addMcpProbingServerIds(workspace: WorkspaceState, serverIds: ReadonlyArray<string>): boolean {
    return this.updateMcpProbingServerIds(workspace, serverIds, 'add');
  }

  removeMcpProbingServerIds(workspace: WorkspaceState, serverIds: ReadonlyArray<string>): boolean {
    return this.updateMcpProbingServerIds(workspace, serverIds, 'remove');
  }

  updateMcpProbingServerIds(
    workspace: WorkspaceState,
    serverIds: ReadonlyArray<string>,
    operation: 'add' | 'remove',
  ): boolean {
    const next = new Set(workspace.mcpProbingServerIds ?? []);
    const before = next.size;

    for (const serverId of serverIds) {
      if (operation === 'add') {
        next.add(serverId);
      } else {
        next.delete(serverId);
      }
    }

    if (next.size === before) {
      return false;
    }

    if (next.size === 0) {
      delete workspace.mcpProbingServerIds;
    } else {
      workspace.mcpProbingServerIds = [...next];
    }

    return true;
  }

  applyMcpProbeResult(workspace: WorkspaceState, result: McpProbeResult): boolean {
    if (result.status !== 'success' || result.tools.length === 0) {
      return false;
    }

    let changed = false;

    for (const server of workspace.settings.tooling.mcpServers) {
      if (server.id !== result.serverId) {
        continue;
      }
      server.probedTools = result.tools;
      changed = true;
    }

    for (const state of this.listDiscoveredToolingStates(workspace)) {
      for (const server of state?.mcpServers ?? []) {
        if (server.id !== result.serverId) {
          continue;
        }
        server.probedTools = result.tools;
        changed = true;
      }
    }

    return changed;
  }

  discoveredServerToDefinition(server: DiscoveredMcpServer): McpServerDefinition {
    if (server.transport === 'local') {
      return {
        id: server.id,
        name: server.name,
        transport: 'local',
        command: server.command,
        args: [...server.args],
        cwd: server.cwd,
        env: server.env ? { ...server.env } : undefined,
        tools: [...server.tools],
        timeoutMs: server.timeoutMs,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    }

    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      url: server.url,
      headers: server.headers ? { ...server.headers } : undefined,
      tools: [...server.tools],
      timeoutMs: server.timeoutMs,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  private async enqueueMcpProbeUpdate(update: () => Promise<void>): Promise<void> {
    const next = this.mcpProbeUpdateQueue.then(update, update);
    this.mcpProbeUpdateQueue = next.catch(() => undefined);
    await next;
  }
}
