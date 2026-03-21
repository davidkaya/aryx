import { createBuiltinPatterns } from '@shared/domain/pattern';
import type { PatternDefinition } from '@shared/domain/pattern';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';
import { nowIso } from '@shared/utils/ids';

import { getWorkspaceFilePath } from '@main/persistence/appPaths';
import { readJsonFile, writeJsonFile } from '@main/persistence/jsonStore';

function mergePatterns(existingPatterns: PatternDefinition[]): PatternDefinition[] {
  const builtinTimestamp = nowIso();
  const builtinPatterns = createBuiltinPatterns(builtinTimestamp);
  const builtinIds = new Set(builtinPatterns.map((pattern) => pattern.id));
  const existingMap = new Map(existingPatterns.map((pattern) => [pattern.id, pattern]));

  const mergedBuiltins = builtinPatterns.map((builtin) => {
    const existing = existingMap.get(builtin.id);
    if (!existing) {
      return builtin;
    }

    return {
      ...existing,
      availability: builtin.availability,
      unavailabilityReason: builtin.unavailabilityReason,
      mode: builtin.mode,
    };
  });

  const customPatterns = existingPatterns.filter((pattern) => !builtinIds.has(pattern.id));
  return [...mergedBuiltins, ...customPatterns];
}

export class WorkspaceRepository {
  readonly filePath = getWorkspaceFilePath();

  async load(): Promise<WorkspaceState> {
    const stored = await readJsonFile<WorkspaceState>(this.filePath);
    if (!stored) {
      const seeded = createWorkspaceSeed();
      await this.save(seeded);
      return seeded;
    }

    const workspace: WorkspaceState = {
      ...stored,
      patterns: mergePatterns(stored.patterns ?? []),
      projects: stored.projects ?? [],
      sessions: stored.sessions ?? [],
      lastUpdatedAt: stored.lastUpdatedAt ?? nowIso(),
    };

    await this.save(workspace);
    return workspace;
  }

  async save(workspace: WorkspaceState): Promise<void> {
    await writeJsonFile(this.filePath, {
      ...workspace,
      lastUpdatedAt: nowIso(),
    });
  }
}
