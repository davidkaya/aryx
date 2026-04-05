import { describe, expect, mock, test } from 'bun:test';

import { buildAvailableModelCatalog } from '@shared/domain/models';
import type { WorkflowDefinition } from '@shared/domain/workflow';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

mock.module('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
      getPath: () => 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures',
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: {
      openPath: async () => '',
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { AryxAppService } = await import('@main/AryxAppService');

function createService(workspace: WorkspaceState): InstanceType<typeof AryxAppService> {
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;
  internals.loadWorkspace = async () => workspace;
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => nextWorkspace;
  internals.loadAvailableModelCatalog = async () => buildAvailableModelCatalog();
  return service;
}

function createAgentWorkflow(id: string, name: string, agentId: string): WorkflowDefinition {
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
          id: agentId,
          kind: 'agent',
          label: name,
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: agentId,
            name,
            description: `${name} description`,
            instructions: `Run ${name}`,
            model: 'gpt-5.4',
          },
        },
        { id: 'end', kind: 'end', label: 'End', position: { x: 400, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: 'edge-start-agent', source: 'start', target: agentId, kind: 'direct' },
        { id: 'edge-agent-end', source: agentId, target: 'end', kind: 'direct' },
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

describe('AryxAppService sub-workflow operations', () => {
  test('rejects saving workflows with missing referenced workflows', async () => {
    const workspace = createWorkspaceSeed();
    const service = createService(workspace);

    await expect(service.saveWorkflow(createSubWorkflow('parent', 'Parent', { workflowId: 'missing-child' })))
      .rejects.toThrow('references unknown workflow "missing-child"');
  });

  test('rejects circular workflow references across saved workflows', async () => {
    const workspace = createWorkspaceSeed();
    workspace.workflows.push(createSubWorkflow('workflow-b', 'Workflow B', { workflowId: 'workflow-a' }));
    const service = createService(workspace);

    await expect(service.saveWorkflow(createSubWorkflow('workflow-a', 'Workflow A', { workflowId: 'workflow-b' })))
      .rejects.toThrow('circular sub-workflow reference');
  });

  test('prevents deleting workflows that are still referenced', async () => {
    const workspace = createWorkspaceSeed();
    workspace.workflows.push(
      createAgentWorkflow('child', 'Child Agent', 'agent-child'),
      createSubWorkflow('parent', 'Parent Workflow', { workflowId: 'child' }),
    );
    const service = createService(workspace);

    await expect(service.deleteWorkflow('child')).rejects.toThrow('cannot be deleted');
  });

  test('lists workflow references for referenced sub-workflows', async () => {
    const workspace = createWorkspaceSeed();
    workspace.workflows.push(
      createAgentWorkflow('child', 'Child Agent', 'agent-child'),
      createSubWorkflow('parent', 'Parent Workflow', { workflowId: 'child' }),
      createSubWorkflow('inline-parent', 'Inline Parent', {
        inlineWorkflow: createSubWorkflow('inline-child', 'Inline Child', { workflowId: 'child' }),
      }),
    );
    const service = createService(workspace);

    const references = await service.listWorkflowReferences('child');

    expect(references).toEqual([
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

  test('creates workflow-backed sessions using nested sub-workflow agents for model defaults', async () => {
    const workspace = createWorkspaceSeed();
    const project = {
      id: 'project-1',
      name: 'Project',
      path: 'C:\\workspace\\project-1',
      addedAt: '2026-04-05T00:00:00.000Z',
    };
    workspace.projects.push(project);
    workspace.workflows.push(
      createAgentWorkflow('child', 'Child Agent', 'agent-child'),
      createSubWorkflow('parent', 'Parent Workflow', { workflowId: 'child' }),
    );
    const service = createService(workspace);

    const result = await service.createWorkflowSession(project.id, 'parent');
    const session = result.sessions[0];

    expect(session?.workflowId).toBe('parent');
    expect(session?.sessionModelConfig).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    });
  });
});
