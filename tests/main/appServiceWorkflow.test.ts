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

describe('AryxAppService workflow operations', () => {
  test('saves workflows into workspace state', async () => {
    const workspace = createWorkspaceSeed();
    const service = createService(workspace);

    const result = await service.saveWorkflow(createWorkflow());

    expect(result.workflows).toHaveLength(1);
    expect(result.selectedWorkflowId).toBe('workflow-test');
  });

  test('creates workflow-backed sessions', async () => {
    const workspace = createWorkspaceSeed();
    const project = {
      id: 'project-1',
      name: 'Project',
      path: 'C:\\workspace\\project-1',
      addedAt: '2026-04-05T00:00:00.000Z',
    };
    workspace.projects.push(project);
    workspace.workflows.push(createWorkflow());
    const service = createService(workspace);

    const result = await service.createWorkflowSession(project.id, 'workflow-test');
    const session = result.sessions[0];

    expect(session?.workflowId).toBe('workflow-test');
    expect(result.selectedWorkflowId).toBe('workflow-test');
  });
});
