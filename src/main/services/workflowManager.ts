import {
  buildWorkflowExecutionDefinition,
  normalizeWorkflowDefinition,
  resolveWorkflowAgentNodes,
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowReference,
} from '@shared/domain/workflow';
import {
  exportWorkflowDefinition,
  importWorkflowDefinition,
  type WorkflowExportFormat,
  type WorkflowExportResult,
} from '@shared/domain/workflowSerialization';
import {
  applyWorkflowTemplate,
  createWorkflowTemplateFromWorkflow,
  normalizeWorkflowTemplateDefinition,
  type WorkflowTemplateCategory,
  type WorkflowTemplateDefinition,
} from '@shared/domain/workflowTemplate';
import { applyDefaultToolApprovalPolicy } from '@shared/domain/approval';
import type { SessionRecord } from '@shared/domain/session';
import type { WorkspaceState } from '@shared/domain/workspace';
import { createId, nowIso } from '@shared/utils/ids';

export class WorkflowManager {
  saveWorkflow(workspace: WorkspaceState, workflow: WorkflowDefinition): WorkspaceState {
    const normalizedWorkflow = normalizeWorkflowDefinition(workflow);
    const issues = validateWorkflowDefinition(normalizedWorkflow).filter((issue) => issue.level === 'error');
    if (issues.length > 0) {
      throw new Error(issues[0].message);
    }

    const existingIndex = workspace.workflows.findIndex((current) => current.id === workflow.id);
    const candidate: WorkflowDefinition = {
      ...normalizedWorkflow,
      isFavorite: workflow.isFavorite ?? workspace.workflows[existingIndex]?.isFavorite,
      createdAt: existingIndex >= 0 ? workspace.workflows[existingIndex].createdAt : nowIso(),
      updatedAt: nowIso(),
    };
    this.validateWorkflowReferences(workspace, candidate);

    if (existingIndex >= 0) {
      workspace.workflows[existingIndex] = candidate;
    } else {
      workspace.workflows.push(candidate);
    }

    workspace.selectedWorkflowId = candidate.id;
    return workspace;
  }

  saveWorkflowTemplate(
    workspace: WorkspaceState,
    workflowId: string,
    options?: {
      templateId?: string;
      name?: string;
      description?: string;
      category?: WorkflowTemplateCategory;
    },
  ): WorkspaceState {
    const workflow = this.requireWorkflow(workspace, workflowId);
    const candidate = createWorkflowTemplateFromWorkflow(workflow, options);
    const existingIndex = workspace.workflowTemplates.findIndex((template) => template.id === candidate.id);
    const existingTemplate = existingIndex >= 0 ? workspace.workflowTemplates[existingIndex] : undefined;
    if (existingTemplate?.source === 'builtin') {
      throw new Error(`Workflow template "${candidate.id}" is reserved by a built-in template.`);
    }

    const normalizedCandidate: WorkflowTemplateDefinition = normalizeWorkflowTemplateDefinition({
      ...candidate,
      createdAt: existingTemplate?.createdAt ?? candidate.createdAt,
      updatedAt: nowIso(),
    });

    if (existingIndex >= 0) {
      workspace.workflowTemplates[existingIndex] = normalizedCandidate;
    } else {
      workspace.workflowTemplates.push(normalizedCandidate);
    }

    return workspace;
  }

  createWorkflowFromTemplate(
    workspace: WorkspaceState,
    templateId: string,
    options?: {
      workflowId?: string;
      name?: string;
      description?: string;
    },
  ): WorkspaceState {
    const template = this.requireWorkflowTemplate(workspace, templateId);
    const workflowId = options?.workflowId?.trim()
      || this.createUniqueWorkflowId(workspace, template.workflow.id);
    const workflow = applyWorkflowTemplate(template, {
      ...options,
      workflowId,
    });

    return this.saveWorkflow(workspace, workflow);
  }

  deleteWorkflow(workspace: WorkspaceState, workflowId: string): WorkspaceState {
    const workflow = this.requireWorkflow(workspace, workflowId);
    const references = this.listWorkflowReferencesInWorkspace(workspace, workflowId)
      .filter((reference) => reference.referencingWorkflowId !== workflowId);
    if (references.length > 0) {
      const blockingReference = references[0];
      throw new Error(
        `Workflow "${workflow.name}" cannot be deleted because workflow "${blockingReference.referencingWorkflowName}" references it from node "${blockingReference.nodeLabel}".`,
      );
    }

    workspace.workflows = workspace.workflows.filter((candidate) => candidate.id !== workflowId);

    if (workspace.selectedWorkflowId === workflowId) {
      workspace.selectedWorkflowId = workspace.workflows[0]?.id;
    }

    return workspace;
  }

  listWorkflowReferences(workspace: WorkspaceState, workflowId: string): WorkflowReference[] {
    this.requireWorkflow(workspace, workflowId);
    return this.listWorkflowReferencesInWorkspace(workspace, workflowId);
  }

  exportWorkflow(workspace: WorkspaceState, workflowId: string, format: WorkflowExportFormat): WorkflowExportResult {
    const workflow = this.requireWorkflow(workspace, workflowId);
    return exportWorkflowDefinition(workflow, format);
  }

  importWorkflow(content: string, format: 'yaml' | 'json'): WorkflowDefinition {
    return importWorkflowDefinition(content, format);
  }

  requireWorkflowTemplate(workspace: WorkspaceState, templateId: string): WorkflowTemplateDefinition {
    const template = workspace.workflowTemplates.find((current) => current.id === templateId);
    if (!template) {
      throw new Error(`Workflow template "${templateId}" was not found.`);
    }

    return template;
  }

  requireWorkflow(workspace: WorkspaceState, workflowId: string): WorkflowDefinition {
    const workflow = workspace.workflows.find((current) => current.id === workflowId);
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" was not found.`);
    }

    return workflow;
  }

  createUniqueWorkflowId(workspace: WorkspaceState, sourceId: string): string {
    const normalizedSourceId = this.normalizeIdentifier(sourceId, 'workflow');
    const existingIds = new Set(workspace.workflows.map((workflow) => workflow.id));
    if (!existingIds.has(normalizedSourceId)) {
      return normalizedSourceId;
    }

    let suffix = 2;
    while (existingIds.has(`${normalizedSourceId}-${suffix}`)) {
      suffix += 1;
    }

    return `${normalizedSourceId}-${suffix}`;
  }

  normalizeIdentifier(value: string, fallbackPrefix: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized || createId(fallbackPrefix);
  }

  resolveSessionWorkflow(workspace: WorkspaceState, session: SessionRecord): WorkflowDefinition {
    return this.requireWorkflow(workspace, session.workflowId);
  }

  buildResolvedExecutionWorkflow(workspace: WorkspaceState, workflow: WorkflowDefinition): WorkflowDefinition {
    return normalizeWorkflowDefinition({
      ...workflow,
      settings: {
        ...workflow.settings,
        approvalPolicy: applyDefaultToolApprovalPolicy(workflow.settings.approvalPolicy),
      },
    });
  }

  createWorkflowResolutionOptions(workspace: WorkspaceState) {
    return {
      resolveWorkflow: (workflowId: string) => workspace.workflows.find((candidate) => candidate.id === workflowId),
    };
  }

  validateWorkflowReferences(workspace: WorkspaceState, workflow: WorkflowDefinition): void {
    const workflowLibrary = new Map<string, WorkflowDefinition>();
    for (const candidate of workspace.workflows) {
      if (candidate.id !== workflow.id) {
        workflowLibrary.set(candidate.id, candidate);
      }
    }
    workflowLibrary.set(workflow.id, workflow);

    const visitWorkflow = (
      currentWorkflow: WorkflowDefinition,
      path: string[],
      visitedInlineWorkflows: Set<WorkflowDefinition>,
    ): void => {
      for (const node of currentWorkflow.graph.nodes) {
        if (node.kind !== 'sub-workflow' || node.config.kind !== 'sub-workflow') {
          continue;
        }

        const { inlineWorkflow, workflowId } = node.config;
        if (workflowId) {
          const referencedWorkflow = workflowLibrary.get(workflowId);
          if (!referencedWorkflow) {
            throw new Error(
              `Sub-workflow node "${node.label || node.id}" references unknown workflow "${workflowId}".`,
            );
          }

          if (path.includes(workflowId)) {
            throw new Error(
              `Saving workflow "${workflow.name}" would create a circular sub-workflow reference: ${[...path, workflowId].join(' -> ')}.`,
            );
          }

          visitWorkflow(referencedWorkflow, [...path, workflowId], visitedInlineWorkflows);
        }

        if (inlineWorkflow && !visitedInlineWorkflows.has(inlineWorkflow)) {
          visitedInlineWorkflows.add(inlineWorkflow);
          visitWorkflow(inlineWorkflow, path, visitedInlineWorkflows);
        }
      }
    };

    visitWorkflow(workflow, [workflow.id], new Set<WorkflowDefinition>());
  }

  listWorkflowReferencesInWorkspace(workspace: WorkspaceState, workflowId: string): WorkflowReference[] {
    const references: WorkflowReference[] = [];

    const visitWorkflow = (
      referencingWorkflow: WorkflowDefinition,
      currentWorkflow: WorkflowDefinition,
      visitedInlineWorkflows: Set<WorkflowDefinition>,
    ): void => {
      for (const node of currentWorkflow.graph.nodes) {
        if (node.kind !== 'sub-workflow' || node.config.kind !== 'sub-workflow') {
          continue;
        }

        const { inlineWorkflow, workflowId: referencedWorkflowId } = node.config;
        if (referencedWorkflowId === workflowId) {
          references.push({
            referencingWorkflowId: referencingWorkflow.id,
            referencingWorkflowName: referencingWorkflow.name,
            nodeId: node.id,
            nodeLabel: node.label || node.id,
          });
        }

        if (inlineWorkflow && !visitedInlineWorkflows.has(inlineWorkflow)) {
          visitedInlineWorkflows.add(inlineWorkflow);
          visitWorkflow(referencingWorkflow, inlineWorkflow, visitedInlineWorkflows);
        }
      }
    };

    for (const referencingWorkflow of workspace.workflows) {
      visitWorkflow(referencingWorkflow, referencingWorkflow, new Set<WorkflowDefinition>());
    }

    return references;
  }

  buildWorkflowExecutionDefinition(workspace: WorkspaceState, workflow: WorkflowDefinition) {
    return buildWorkflowExecutionDefinition(
      this.buildResolvedExecutionWorkflow(workspace, workflow),
      this.createWorkflowResolutionOptions(workspace),
    );
  }

  resolveWorkflowAgentNodes(workspace: WorkspaceState, workflow: WorkflowDefinition) {
    void workspace;
    return resolveWorkflowAgentNodes(this.buildResolvedExecutionWorkflow(workspace, workflow));
  }
}
