import { mkdir } from 'node:fs/promises';

import { createBuiltinPatterns } from '@shared/domain/pattern';
import type { PatternDefinition } from '@shared/domain/pattern';
import { mergeScratchpadProject } from '@shared/domain/project';
import { normalizeSessionRunRecords } from '@shared/domain/runTimeline';
import {
  normalizeSessionToolingSelection,
  normalizeWorkspaceSettings,
} from '@shared/domain/tooling';
import {
  normalizeApprovalPolicy,
  normalizePendingApprovalState,
  normalizeSessionApprovalSettings,
} from '@shared/domain/approval';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';
import { nowIso } from '@shared/utils/ids';

import { getScratchpadDirectoryPath, getWorkspaceFilePath } from '@main/persistence/appPaths';
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
  readonly scratchpadPath = getScratchpadDirectoryPath();

  async load(): Promise<WorkspaceState> {
    await mkdir(this.scratchpadPath, { recursive: true });

    const stored = await readJsonFile<WorkspaceState>(this.filePath);
    if (!stored) {
      const seededBase = createWorkspaceSeed();
      const projects = mergeScratchpadProject([], this.scratchpadPath);
      const seeded: WorkspaceState = {
        ...seededBase,
        projects,
        selectedProjectId: projects[0]?.id,
      };
      await this.save(seeded);
      return seeded;
    }

    const projects = mergeScratchpadProject(stored.projects ?? [], this.scratchpadPath);
    const settings = normalizeWorkspaceSettings(stored.settings);

    const workspace: WorkspaceState = {
      ...stored,
      patterns: mergePatterns(stored.patterns ?? []).map((pattern) => ({
        ...pattern,
        approvalPolicy: normalizeApprovalPolicy(pattern.approvalPolicy),
      })),
      projects,
      sessions: (stored.sessions ?? []).map((session) => ({
        ...session,
        runs: normalizeSessionRunRecords(session.runs),
        tooling: normalizeSessionToolingSelection(session.tooling),
        approvalSettings: normalizeSessionApprovalSettings(session.approvalSettings),
        ...normalizePendingApprovalState({
          pendingApproval: session.pendingApproval,
          pendingApprovalQueue: session.pendingApprovalQueue,
        }),
      })),
      settings,
      selectedProjectId: projects.some((project) => project.id === stored.selectedProjectId)
        ? stored.selectedProjectId
        : projects[0]?.id,
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
