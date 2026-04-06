import { mkdir } from 'node:fs/promises';

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
import {
  createBuiltinWorkflows,
  normalizeWorkflowDefinition,
  type WorkflowDefinition,
} from '@shared/domain/workflow';
import {
  applyDefaultToolApprovalPolicy,
  normalizePendingApprovalState,
  normalizeSessionApprovalSettings,
} from '@shared/domain/approval';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';
import { isScratchpadProject, mergeScratchpadProject } from '@shared/domain/project';
import { nowIso } from '@shared/utils/ids';

import {
  getScratchpadDirectoryPath,
  getScratchpadSessionPath,
  getWorkspaceFilePath,
} from '@main/persistence/appPaths';
import { readJsonFile, writeJsonFile } from '@main/persistence/jsonStore';

function mergeBuiltinWorkflows(existingWorkflows: WorkflowDefinition[]): WorkflowDefinition[] {
  const builtinWorkflows = createBuiltinWorkflows(nowIso());
  const builtinIds = new Set(builtinWorkflows.map((workflow) => workflow.id));
  const existingMap = new Map(existingWorkflows.map((workflow) => [workflow.id, workflow]));

  const mergedBuiltins = builtinWorkflows.map((builtin) => {
    const existing = existingMap.get(builtin.id);
    if (!existing) {
      return builtin;
    }

    return normalizeWorkflowDefinition({
      ...existing,
      settings: {
        ...existing.settings,
        orchestrationMode: builtin.settings.orchestrationMode,
      },
    });
  });

  const customWorkflows = existingWorkflows
    .filter((workflow) => !builtinIds.has(workflow.id))
    .map(normalizeWorkflowDefinition);

  return [...mergedBuiltins, ...customWorkflows];
}

function mergeWorkflowTemplates(existingTemplates: WorkflowTemplateDefinition[]): WorkflowTemplateDefinition[] {
  const builtinTemplates = createBuiltinWorkflowTemplates(nowIso());
  const builtinIds = new Set(builtinTemplates.map((template) => template.id));
  const customTemplates = existingTemplates
    .map(normalizeWorkflowTemplateDefinition)
    .filter((template) => template.source !== 'builtin' && !builtinIds.has(template.id));

  return [...builtinTemplates, ...customTemplates];
}

function migrateLegacySessions(
  sessions: SessionRecord[],
  workflows: WorkflowDefinition[],
): SessionRecord[] {
  const workflowIds = new Set(workflows.map((workflow) => workflow.id));
  const fallbackWorkflowId = workflows[0]?.id;

  return sessions.flatMap((session) => {
    const workflowId = session.workflowId && workflowIds.has(session.workflowId)
      ? session.workflowId
      : fallbackWorkflowId;
    if (!workflowId) {
      return [];
    }

    return [{
      ...session,
      workflowId,
    }];
  });
}

export class WorkspaceRepository {
  readonly filePath = getWorkspaceFilePath();
  readonly scratchpadPath = getScratchpadDirectoryPath();

  async load(): Promise<WorkspaceState> {
    await mkdir(this.scratchpadPath, { recursive: true });

    const stored = await readJsonFile<WorkspaceState & { patterns?: unknown[] }>(this.filePath);
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

    const workflows = mergeBuiltinWorkflows((stored.workflows ?? []).map(normalizeWorkflowDefinition))
      .map((workflow) => ({
        ...workflow,
        settings: {
          ...workflow.settings,
          approvalPolicy: applyDefaultToolApprovalPolicy(workflow.settings.approvalPolicy),
        },
      }));

    const sessions = migrateLegacySessions(
      await Promise.all((stored.sessions ?? []).map(async (session): Promise<SessionRecord> => {
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
      })),
      workflows,
    );

    const settings = normalizeWorkspaceSettings(stored.settings);
    const workspace: WorkspaceState = {
      ...stored,
      workflows,
      workflowTemplates: mergeWorkflowTemplates(stored.workflowTemplates ?? []),
      projects,
      sessions,
      settings,
      selectedProjectId: projects.some((project) => project.id === stored.selectedProjectId)
        ? stored.selectedProjectId
        : projects[0]?.id,
      selectedWorkflowId: workflows.some((workflow) => workflow.id === stored.selectedWorkflowId)
        ? stored.selectedWorkflowId
        : workflows[0]?.id,
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
