import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import {
  applyDiscoveredMcpServerStatus,
  normalizeDiscoveredToolingState,
  type DiscoveredMcpServer,
  type DiscoveredToolingState,
  type DiscoveredToolingStatus,
} from '@shared/domain/discoveredTooling';
import {
  normalizeProjectCustomizationState,
  type ProjectCustomizationState,
} from '@shared/domain/projectCustomization';
import type { WorkspaceState } from '@shared/domain/workspace';

import { ConfigScannerRegistry } from '@main/services/configScanner';
import { ProjectCustomizationScanner } from '@main/services/customizationScanner';
import { ProjectCustomizationWatcher } from '@main/services/projectCustomizationWatcher';

export type DiscoveredToolingResolution = 'accept' | 'dismiss';

type DiscoveredToolingSyncServiceDeps = {
  configScanner: ConfigScannerRegistry;
  customizationScanner: ProjectCustomizationScanner;
  projectCustomizationWatcher: ProjectCustomizationWatcher;
  loadWorkspace: () => Promise<WorkspaceState>;
  persistWorkspace: (workspace: WorkspaceState) => Promise<void>;
};

export class DiscoveredToolingSyncService {
  private customizationWatcherUpdateQueue = Promise.resolve();

  private readonly configScanner: ConfigScannerRegistry;
  private readonly customizationScanner: ProjectCustomizationScanner;
  private readonly projectCustomizationWatcher: ProjectCustomizationWatcher;
  private readonly loadWorkspace: () => Promise<WorkspaceState>;
  private readonly persistWorkspace: (workspace: WorkspaceState) => Promise<void>;

  constructor(deps: DiscoveredToolingSyncServiceDeps) {
    this.configScanner = deps.configScanner;
    this.customizationScanner = deps.customizationScanner;
    this.projectCustomizationWatcher = deps.projectCustomizationWatcher;
    this.loadWorkspace = deps.loadWorkspace;
    this.persistWorkspace = deps.persistWorkspace;
  }

  async syncUserDiscoveredTooling(workspace: WorkspaceState): Promise<boolean> {
    const nextState = await this.configScanner.scanUser(workspace.settings.discoveredUserTooling);
    if (this.equalDiscoveredToolingState(workspace.settings.discoveredUserTooling, nextState)) {
      return false;
    }

    workspace.settings.discoveredUserTooling = nextState;
    return true;
  }

  async syncProjectCustomizationWatchers(workspace: WorkspaceState): Promise<void> {
    await this.projectCustomizationWatcher.syncProjects(
      workspace.projects
        .filter((project) => !isScratchpadProject(project))
        .map((project) => ({
          id: project.id,
          path: project.path,
        })),
    );
  }

  async handleProjectCustomizationWatcherChange(projectId: string): Promise<void> {
    await this.enqueueCustomizationWatcherUpdate(async () => {
      const workspace = await this.loadWorkspace();
      const project = workspace.projects.find((candidate) => candidate.id === projectId);
      await this.syncProjectCustomizationWatchers(workspace);

      if (!project || isScratchpadProject(project)) {
        return;
      }

      const didSyncProjectCustomization = await this.syncProjectCustomization(project);
      await this.syncProjectCustomizationWatchers(workspace);
      if (didSyncProjectCustomization) {
        await this.persistWorkspace(workspace);
      }
    });
  }

  async syncProjectCustomization(project: ProjectRecord): Promise<boolean> {
    if (isScratchpadProject(project)) {
      if (!project.customization || this.equalProjectCustomizationState(project.customization, undefined)) {
        return false;
      }

      project.customization = undefined;
      return true;
    }

    const nextState = await this.customizationScanner.scanProject(project.path, project.customization);
    if (this.equalProjectCustomizationState(project.customization, nextState)) {
      return false;
    }

    project.customization = nextState;
    return true;
  }

  async syncProjectDiscoveredTooling(
    workspace: WorkspaceState,
    project: ProjectRecord,
  ): Promise<boolean> {
    if (isScratchpadProject(project)) {
      if (!project.discoveredTooling || this.equalDiscoveredToolingState(project.discoveredTooling, undefined)) {
        return false;
      }

      project.discoveredTooling = undefined;
      return true;
    }

    const nextState = await this.configScanner.scanProject(
      project.id,
      project.path,
      project.discoveredTooling,
    );
    if (this.equalDiscoveredToolingState(project.discoveredTooling, nextState)) {
      return false;
    }

    project.discoveredTooling = nextState;
    return true;
  }

  resolveDiscoveredToolingStatus(
    resolution: DiscoveredToolingResolution,
  ): Exclude<DiscoveredToolingStatus, 'pending'> {
    return resolution === 'accept' ? 'accepted' : 'dismissed';
  }

  resolveWorkspaceDiscoveredTooling(
    workspace: WorkspaceState,
    serverIds: string[],
    resolution: DiscoveredToolingResolution,
  ): void {
    workspace.settings.discoveredUserTooling = applyDiscoveredMcpServerStatus(
      workspace.settings.discoveredUserTooling,
      serverIds,
      this.resolveDiscoveredToolingStatus(resolution),
    );
  }

  resolveProjectDiscoveredTooling(
    project: ProjectRecord,
    serverIds: string[],
    resolution: DiscoveredToolingResolution,
  ): void {
    project.discoveredTooling = applyDiscoveredMcpServerStatus(
      project.discoveredTooling,
      serverIds,
      this.resolveDiscoveredToolingStatus(resolution),
    );
  }

  equalDiscoveredToolingState(
    left?: DiscoveredToolingState,
    right?: DiscoveredToolingState,
  ): boolean {
    const stripRuntime = (servers: DiscoveredMcpServer[]) =>
      servers.map(({ probedTools: _, ...rest }) => rest);
    return JSON.stringify(stripRuntime(normalizeDiscoveredToolingState(left).mcpServers))
      === JSON.stringify(stripRuntime(normalizeDiscoveredToolingState(right).mcpServers));
  }

  equalProjectCustomizationState(
    left?: ProjectCustomizationState,
    right?: ProjectCustomizationState,
  ): boolean {
    const normalizedLeft = normalizeProjectCustomizationState(left);
    const normalizedRight = normalizeProjectCustomizationState(right);
    return JSON.stringify({
      instructions: normalizedLeft.instructions,
      agentProfiles: normalizedLeft.agentProfiles,
      promptFiles: normalizedLeft.promptFiles,
    }) === JSON.stringify({
      instructions: normalizedRight.instructions,
      agentProfiles: normalizedRight.agentProfiles,
      promptFiles: normalizedRight.promptFiles,
    });
  }

  private enqueueCustomizationWatcherUpdate(task: () => Promise<void>): Promise<void> {
    const scheduledTask = this.customizationWatcherUpdateQueue.then(task, task);
    this.customizationWatcherUpdateQueue = scheduledTask.then(
      () => undefined,
      () => undefined,
    );
    return scheduledTask;
  }
}
