import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveProjectCustomizationRoots } from '@main/services/projectCustomizationRoots';

export interface ProjectCustomizationWatchTarget {
  id: string;
  path: string;
}

type ProjectWatchHandle = {
  close(): void;
};

type ProjectWatchFactory = (
  directoryPath: string,
  onChange: () => void,
) => ProjectWatchHandle;

type ProjectWatchPathResolver = (projectPath: string) => Promise<string[]>;

export class ProjectCustomizationWatcher {
  private readonly watchFactory: ProjectWatchFactory;
  private readonly resolveWatchPaths: ProjectWatchPathResolver;
  private readonly debounceMs: number;
  private readonly watchHandlesByProjectId = new Map<string, Map<string, ProjectWatchHandle>>();
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onChange: (projectId: string) => void | Promise<void>,
    options?: {
      watchFactory?: ProjectWatchFactory;
      resolveWatchPaths?: ProjectWatchPathResolver;
      debounceMs?: number;
    },
  ) {
    this.watchFactory = options?.watchFactory ?? createProjectWatchHandle;
    this.resolveWatchPaths = options?.resolveWatchPaths ?? collectProjectCustomizationWatchPaths;
    this.debounceMs = options?.debounceMs ?? 250;
  }

  async syncProjects(projects: ReadonlyArray<ProjectCustomizationWatchTarget>): Promise<void> {
    const nextProjectsById = new Map(projects.map((project) => [project.id, project]));

    for (const projectId of this.watchHandlesByProjectId.keys()) {
      if (!nextProjectsById.has(projectId)) {
        this.unwatchProject(projectId);
      }
    }

    for (const project of projects) {
      await this.syncProject(project);
    }
  }

  dispose(): void {
    for (const projectId of this.watchHandlesByProjectId.keys()) {
      this.unwatchProject(projectId);
    }
  }

  private async syncProject(project: ProjectCustomizationWatchTarget): Promise<void> {
    const nextWatchPaths = new Set(await this.resolveWatchPaths(project.path));
    const currentWatchHandles = this.watchHandlesByProjectId.get(project.id) ?? new Map<string, ProjectWatchHandle>();

    for (const [watchPath, handle] of currentWatchHandles) {
      if (nextWatchPaths.has(watchPath)) {
        continue;
      }

      handle.close();
      currentWatchHandles.delete(watchPath);
    }

    for (const watchPath of nextWatchPaths) {
      if (currentWatchHandles.has(watchPath)) {
        continue;
      }

      try {
        currentWatchHandles.set(watchPath, this.watchFactory(watchPath, () => this.scheduleChange(project.id)));
      } catch (error) {
        console.warn(`[aryx customization] Failed to watch ${watchPath}:`, error);
      }
    }

    if (currentWatchHandles.size > 0) {
      this.watchHandlesByProjectId.set(project.id, currentWatchHandles);
      return;
    }

    this.watchHandlesByProjectId.delete(project.id);
  }

  private unwatchProject(projectId: string): void {
    const timer = this.pendingTimers.get(projectId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(projectId);
    }

    const watchHandles = this.watchHandlesByProjectId.get(projectId);
    if (!watchHandles) {
      return;
    }

    for (const handle of watchHandles.values()) {
      handle.close();
    }

    this.watchHandlesByProjectId.delete(projectId);
  }

  private scheduleChange(projectId: string): void {
    const existingTimer = this.pendingTimers.get(projectId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(projectId);
      void Promise.resolve(this.onChange(projectId)).catch((error) => {
        console.warn(`[aryx customization] Failed to process watcher update for ${projectId}:`, error);
      });
    }, this.debounceMs);
    timer.unref?.();
    this.pendingTimers.set(projectId, timer);
  }
}

export async function collectProjectCustomizationWatchPaths(projectPath: string): Promise<string[]> {
  const paths = new Set<string>();

  for (const customizationRoot of await resolveProjectCustomizationRoots(projectPath)) {
    paths.add(customizationRoot);

    for (const relativeRoot of ['.github', '.claude']) {
      for (const directoryPath of await collectExistingDirectories(join(customizationRoot, relativeRoot))) {
        paths.add(directoryPath);
      }
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

async function collectExistingDirectories(rootPath: string): Promise<string[]> {
  try {
    const directories = [rootPath];
    const entries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) {
        continue;
      }

      directories.push(...await collectExistingDirectories(join(rootPath, entry.name)));
    }

    return directories;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    console.warn(`[aryx customization] Failed to enumerate watch paths under ${rootPath}:`, error);
    return [];
  }
}

function createProjectWatchHandle(directoryPath: string, onChange: () => void): ProjectWatchHandle {
  return watch(directoryPath, { persistent: false }, () => {
    onChange();
  });
}
