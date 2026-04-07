import { describe, expect, test } from 'bun:test';

import type { WorkflowDefinition } from '@shared/domain/workflow';
import { exportWorkflowDefinition } from '@shared/domain/workflowSerialization';
import { createWorkspaceSeed } from '@shared/domain/workspace';

import { WorkflowManager } from '@main/services/workflowManager';

function createWorkflow(): WorkflowDefinition {
  return {
    id: 'workflow-test',
    name: 'Workflow Test',
    description: 'Simple workflow',
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
    graph: {
      nodes: [
        { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
        {
          id: 'agent-primary',
          kind: 'agent',
          label: 'Primary',
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: 'agent-primary',
            name: 'Primary',
            description: 'Main agent',
            instructions: 'Help the user',
            model: 'gpt-5.4',
          },
        },
        { id: 'end', kind: 'end', label: 'End', position: { x: 400, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'agent-primary', kind: 'direct' },
        { id: 'e2', source: 'agent-primary', target: 'end', kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
    },
  };
}

function createSubWorkflow(
  id: string,
  name: string,
  config: { workflowId?: string; inlineWorkflow?: WorkflowDefinition },
): WorkflowDefinition {
  return {
    id,
    name,
    description: `${name} description`,
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
    graph: {
      nodes: [
        { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
        {
          id: 'sub-workflow',
          kind: 'sub-workflow',
          label: 'Nested Workflow',
          position: { x: 200, y: 0 },
          config: {
            kind: 'sub-workflow',
            workflowId: config.workflowId,
            inlineWorkflow: config.inlineWorkflow,
          },
        },
        { id: 'end', kind: 'end', label: 'End', position: { x: 400, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: 'edge-start-sub', source: 'start', target: 'sub-workflow', kind: 'direct' },
        { id: 'edge-sub-end', source: 'sub-workflow', target: 'end', kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
    },
  };
}

describe('WorkflowManager', () => {
  test('saves workflows into workspace state and selects them', () => {
    const workspace = createWorkspaceSeed();
    const manager = new WorkflowManager();

    const result = manager.saveWorkflow(workspace, createWorkflow());

    expect(result.workflows.some((workflow) => workflow.id === 'workflow-test')).toBe(true);
    expect(result.selectedWorkflowId).toBe('workflow-test');
  });

  test('creates workflow templates and workflows from templates', () => {
    const workspace = createWorkspaceSeed();
    const manager = new WorkflowManager();
    manager.saveWorkflow(workspace, createWorkflow());

    manager.saveWorkflowTemplate(workspace, 'workflow-test', {
      name: 'Saved Template',
      description: 'From workflow',
      category: 'human-in-loop',
    });

    const template = workspace.workflowTemplates.find((candidate) => candidate.name === 'Saved Template');
    expect(template).toBeDefined();

    manager.createWorkflowFromTemplate(workspace, template!.id, { name: 'Template Copy' });

    const createdWorkflow = workspace.workflows.find((workflow) => workflow.name === 'Template Copy');
    expect(createdWorkflow).toBeDefined();
    expect(workspace.selectedWorkflowId).toBe(createdWorkflow?.id);
  });

  test('imports exported yaml workflows', () => {
    const manager = new WorkflowManager();
    const yaml = exportWorkflowDefinition(createWorkflow(), 'yaml').content;

    const workflow = manager.importWorkflow(yaml, 'yaml');

    expect(workflow.id).toBe('workflow-test');
    expect(workflow.name).toBe('Workflow Test');
  });

  test('rejects missing and circular sub-workflow references', () => {
    const manager = new WorkflowManager();
    const missingWorkspace = createWorkspaceSeed();

    expect(() => manager.saveWorkflow(
      missingWorkspace,
      createSubWorkflow('parent', 'Parent', { workflowId: 'missing-child' }),
    )).toThrow('references unknown workflow "missing-child"');

    const circularWorkspace = createWorkspaceSeed();
    circularWorkspace.workflows.push(
      createSubWorkflow('workflow-b', 'Workflow B', { workflowId: 'workflow-a' }),
    );

    expect(() => manager.saveWorkflow(
      circularWorkspace,
      createSubWorkflow('workflow-a', 'Workflow A', { workflowId: 'workflow-b' }),
    )).toThrow('circular sub-workflow reference');
  });

  test('prevents deleting referenced workflows and lists references through inline workflows', () => {
    const workspace = createWorkspaceSeed();
    const manager = new WorkflowManager();

    manager.saveWorkflow(workspace, createWorkflow());
    manager.saveWorkflow(
      workspace,
      createSubWorkflow('parent', 'Parent Workflow', { workflowId: 'workflow-test' }),
    );
    manager.saveWorkflow(
      workspace,
      createSubWorkflow('inline-parent', 'Inline Parent', {
        inlineWorkflow: createSubWorkflow('inline-child', 'Inline Child', { workflowId: 'workflow-test' }),
      }),
    );

    expect(() => manager.deleteWorkflow(workspace, 'workflow-test')).toThrow('cannot be deleted');
    expect(manager.listWorkflowReferences(workspace, 'workflow-test')).toEqual([
      {
        referencingWorkflowId: 'parent',
        referencingWorkflowName: 'Parent Workflow',
        nodeId: 'sub-workflow',
        nodeLabel: 'Nested Workflow',
      },
      {
        referencingWorkflowId: 'inline-parent',
        referencingWorkflowName: 'Inline Parent',
        nodeId: 'sub-workflow',
        nodeLabel: 'Nested Workflow',
      },
    ]);
  });
});
