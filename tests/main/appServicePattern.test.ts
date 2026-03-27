import { describe, expect, mock, test } from 'bun:test';

import type { PatternDefinition } from '@shared/domain/pattern';
import { resolvePatternGraph } from '@shared/domain/pattern';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-27T00:00:00.000Z';

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

function createService(
  workspace: WorkspaceState,
  options?: { knownApprovalToolNames?: string[] },
): InstanceType<typeof AryxAppService> {
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;
  internals.loadWorkspace = async () => workspace;
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => nextWorkspace;
  internals.listKnownApprovalToolNames = async () => options?.knownApprovalToolNames ?? ['read', 'write', 'shell'];

  return service;
}

function requirePattern(workspace: WorkspaceState, mode: PatternDefinition['mode']): PatternDefinition {
  const pattern = workspace.patterns.find((candidate) => candidate.mode === mode);
  if (!pattern) {
    throw new Error(`Expected workspace seed to include a ${mode} pattern.`);
  }

  return pattern;
}

describe('AryxAppService savePattern', () => {
  test('preserves a provided custom graph instead of re-syncing it', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requirePattern(workspace, 'sequential');
    const baseGraph = resolvePatternGraph(pattern);
    const customGraph = {
      ...baseGraph,
      nodes: baseGraph.nodes.map((node, index) => ({
        ...node,
        position: {
          x: node.position.x + 37 + index,
          y: node.position.y + 19 + index * 7,
        },
      })),
    };
    const service = createService(workspace);

    const result = await service.savePattern({
      ...pattern,
      graph: customGraph,
      updatedAt: TIMESTAMP,
    });

    const savedPattern = requirePattern(result, 'sequential');
    expect(savedPattern.graph).toEqual(customGraph);
  });

  test('still seeds a default graph when the pattern graph is missing', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requirePattern(workspace, 'group-chat');
    const service = createService(workspace);

    const result = await service.savePattern({
      ...pattern,
      graph: undefined,
      updatedAt: TIMESTAMP,
    });

    const savedPattern = requirePattern(result, 'group-chat');
    expect(savedPattern.graph).toEqual(resolvePatternGraph(pattern));
  });
});
