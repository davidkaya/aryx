import { mkdir } from 'node:fs/promises';

import { createBuiltinPatterns, resolvePatternGraph } from '@shared/domain/pattern';
import type { PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, mergeScratchpadProject } from '@shared/domain/project';
import { normalizeDiscoveredToolingState } from '@shared/domain/discoveredTooling';
import { normalizeProjectCustomizationState } from '@shared/domain/projectCustomization';
import { normalizeSessionRunRecords } from '@shared/domain/runTimeline';
import {
  normalizeChatMessageRecord,
  normalizeSessionBranchOrigin,
  type SessionRecord,
} from '@shared/domain/session';
import {
  normalizeSessionToolingSelection,
  normalizeWorkspaceSettings,
} from '@shared/domain/tooling';
import {
  createBuiltinWorkflowTemplates,
  normalizeWorkflowTemplateDefinition,
  type WorkflowTemplateDefinition,
} from '@shared/domain/workflowTemplate';
import { normalizeWorkflowDefinition } from '@shared/domain/workflow';
import {
  applyDefaultToolApprovalPolicy,
  normalizePendingApprovalState,
  normalizeSessionApprovalSettings,
} from '@shared/domain/approval';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';
import { nowIso } from '@shared/utils/ids';

import {
  getScratchpadDirectoryPath,
  getScratchpadSessionPath,
  getWorkspaceFilePath,
} from '@main/persistence/appPaths';
import { readJsonFile, writeJsonFile } from '@main/persistence/jsonStore';

function mergePatterns(existingPatterns: PatternDefinition[], deletedBuiltinIds: string[]): PatternDefinition[] {
  const builtinTimestamp = nowIso();
  const builtinPatterns = createBuiltinPatterns(builtinTimestamp);
  const builtinIds = new Set(builtinPatterns.map((pattern) => pattern.id));
  const deletedSet = new Set(deletedBuiltinIds);
  const existingMap = new Map(existingPatterns.map((pattern) => [pattern.id, pattern]));

  const mergedBuiltins = builtinPatterns
    .filter((builtin) => !deletedSet.has(builtin.id))
    .map((builtin) => {
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

function mergeWorkflowTemplates(existingTemplates: WorkflowTemplateDefinition[]): WorkflowTemplateDefinition[] {
  const builtinTemplates = createBuiltinWorkflowTemplates(nowIso());
  const builtinIds = new Set(builtinTemplates.map((template) => template.id));
  const customTemplates = existingTemplates
    .map(normalizeWorkflowTemplateDefinition)
    .filter((template) => template.source !== 'builtin' && !builtinIds.has(template.id));

  return [...builtinTemplates, ...customTemplates];
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

    const projects = mergeScratchpadProject(
      (stored.projects ?? []).map((project) => ({
        ...project,
        discoveredTooling: normalizeDiscoveredToolingState(project.discoveredTooling),
        customization: normalizeProjectCustomizationState(project.customization),
      })),
      this.scratchpadPath,
    );
    const sessions = await Promise.all((stored.sessions ?? []).map(async (session): Promise<SessionRecord> => {
      const normalizedSession: SessionRecord = {
        ...session,
        messages: (session.messages ?? []).map(normalizeChatMessageRecord),
        branchOrigin: normalizeSessionBranchOrigin(session.branchOrigin),
        runs: normalizeSessionRunRecords(session.runs),
        tooling: normalizeSessionToolingSelection(session.tooling),
        approvalSettings: normalizeSessionApprovalSettings(session.approvalSettings),
        ...normalizePendingApprovalState({
          pendingApproval: session.pendingApproval,
          pendingApprovalQueue: session.pendingApprovalQueue,
        }),
      };
      if (!isScratchpadProject(normalizedSession.projectId)) {
        return normalizedSession;
      }

      const cwd = normalizedSession.cwd ?? getScratchpadSessionPath(normalizedSession.id);
      await mkdir(cwd, { recursive: true });
      return {
        ...normalizedSession,
        cwd,
      };
    }));
    const settings = normalizeWorkspaceSettings(stored.settings);

    const deletedBuiltinPatternIds = stored.deletedBuiltinPatternIds ?? [];

    const workspace: WorkspaceState = {
      ...stored,
      patterns: mergePatterns(stored.patterns ?? [], deletedBuiltinPatternIds).map((pattern) => ({
        ...pattern,
        approvalPolicy: applyDefaultToolApprovalPolicy(pattern.approvalPolicy),
        graph: resolvePatternGraph(pattern),
      })),
      workflows: (stored.workflows ?? []).map(normalizeWorkflowDefinition),
      workflowTemplates: mergeWorkflowTemplates(stored.workflowTemplates ?? []),
      projects,
      sessions,
      settings,
      deletedBuiltinPatternIds,
      selectedProjectId: projects.some((project) => project.id === stored.selectedProjectId)
        ? stored.selectedProjectId
        : projects[0]?.id,
      lastUpdatedAt: stored.lastUpdatedAt ?? nowIso(),
    };

    await this.save(workspace);
    return workspace;
  }

  async save(workspace: WorkspaceState): Promise<void> {
    const { mcpProbingServerIds: _mcpProbingServerIds, ...persistedWorkspace } = workspace;
    await writeJsonFile(this.filePath, {
      ...persistedWorkspace,
      lastUpdatedAt: nowIso(),
    });
  }
}
