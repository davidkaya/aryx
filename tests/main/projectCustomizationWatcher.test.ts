import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectProjectCustomizationWatchPaths,
  ProjectCustomizationWatcher,
} from '@main/services/projectCustomizationWatcher';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aryx-customization-watcher-'));
  temporaryPaths.push(directory);
  return directory;
}

describe('ProjectCustomizationWatcher', () => {
  test('collects the project root plus existing customization directories recursively', async () => {
    const projectPath = await createTempDirectory();
    await mkdir(join(projectPath, '.claude', 'rules'), { recursive: true });
    await mkdir(join(projectPath, '.github', 'prompts', 'docs'), { recursive: true });

    expect(await collectProjectCustomizationWatchPaths(projectPath)).toEqual([
      projectPath,
      join(projectPath, '.claude'),
      join(projectPath, '.claude', 'rules'),
      join(projectPath, '.github'),
      join(projectPath, '.github', 'prompts'),
      join(projectPath, '.github', 'prompts', 'docs'),
    ]);
  });

  test('debounces change notifications and closes watches when projects are removed', async () => {
    const changeCalls: string[] = [];
    const closeByPath = new Map<string, ReturnType<typeof mock>>();
    const listenersByPath = new Map<string, () => void>();
    const watcher = new ProjectCustomizationWatcher(
      async (projectId) => {
        changeCalls.push(projectId);
      },
      {
        debounceMs: 20,
        resolveWatchPaths: async (projectPath) => [projectPath, `${projectPath}\\.github`],
        watchFactory: (directoryPath, onChange) => {
          const close = mock(() => undefined);
          closeByPath.set(directoryPath, close);
          listenersByPath.set(directoryPath, onChange);
          return { close };
        },
      },
    );

    await watcher.syncProjects([
      {
        id: 'project-alpha',
        path: 'C:\\workspace\\alpha',
      },
    ]);

    listenersByPath.get('C:\\workspace\\alpha')?.();
    listenersByPath.get('C:\\workspace\\alpha\\.github')?.();

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(changeCalls).toEqual(['project-alpha']);

    await watcher.syncProjects([]);

    expect(closeByPath.get('C:\\workspace\\alpha')).toHaveBeenCalled();
    expect(closeByPath.get('C:\\workspace\\alpha\\.github')).toHaveBeenCalled();
  });
});
