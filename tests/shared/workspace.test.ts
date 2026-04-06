import { describe, expect, test } from 'bun:test';

import { createWorkspaceSeed } from '@shared/domain/workspace';

describe('workspace seed', () => {
  test('starts empty and seeds built-in workflows and workflow templates with a shared timestamp', () => {
    const workspace = createWorkspaceSeed();

    expect(workspace.projects).toEqual([]);
    expect(workspace.sessions).toEqual([]);
    expect(workspace.settings).toEqual({
      theme: 'dark',
      tooling: {
        mcpServers: [],
        lspProfiles: [],
      },
      discoveredUserTooling: {
        mcpServers: [],
      },
    });
    expect(workspace.selectedProjectId).toBeUndefined();
    expect(workspace.selectedWorkflowId).toBeUndefined();
    expect(workspace.selectedSessionId).toBeUndefined();

    expect(workspace.workflows.map((workflow) => workflow.settings.orchestrationMode)).toEqual([
      'single',
      'sequential',
      'concurrent',
      'handoff',
      'group-chat',
    ]);
    expect(workspace.workflowTemplates.map((template) => template.id)).toEqual([
      'workflow-template-code-review',
      'workflow-template-research-summarize',
      'workflow-template-customer-support',
      'workflow-template-content-creation',
      'workflow-template-multi-agent-debate',
      'workflow-template-data-processing',
      'workflow-template-approval',
      'workflow-template-nested-orchestrator',
    ]);

    for (const workflow of workspace.workflows) {
      expect(workflow.createdAt).toBe(workspace.lastUpdatedAt);
      expect(workflow.updatedAt).toBe(workspace.lastUpdatedAt);
      expect(workflow.settings.approvalPolicy).toBeUndefined();
    }

    for (const template of workspace.workflowTemplates) {
      expect(template.createdAt).toBe(workspace.lastUpdatedAt);
      expect(template.updatedAt).toBe(workspace.lastUpdatedAt);
    }
  });
});
