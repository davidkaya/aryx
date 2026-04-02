import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function resolveProjectCustomizationRoots(projectPath: string): Promise<string[]> {
  if (await hasGitEntry(projectPath)) {
    return [projectPath];
  }

  const ancestorPaths: string[] = [];
  let currentPath = projectPath;
  while (true) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return [projectPath];
    }

    ancestorPaths.push(parentPath);
    if (await hasGitEntry(parentPath)) {
      return [projectPath, ...ancestorPaths];
    }

    currentPath = parentPath;
  }
}

async function hasGitEntry(directoryPath: string): Promise<boolean> {
  try {
    await access(join(directoryPath, '.git'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    console.warn(`[aryx customization] Failed to inspect ${join(directoryPath, '.git')}:`, error);
    return false;
  }
}
