import { describe, expect, test } from 'bun:test';

import type { SidecarModelCapability } from '@shared/contracts/sidecar';
import {
  buildAvailableModelCatalog,
  findModel,
  findModelByReference,
  normalizeWorkflowModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import type { WorkflowDefinition } from '@shared/domain/workflow';

const availableModels: SidecarModelCapability[] = [
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    supportedReasoningEfforts: [],
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
  },
];

function createWorkflow(): WorkflowDefinition {
  return {
    id: 'pattern-1',
    name: 'Pattern',
    description: '',
    graph: {
      nodes: [
        { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
        {
          id: 'agent-1',
          kind: 'agent',
          label: 'Primary Agent',
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: 'agent-1',
            name: 'Primary Agent',
            description: 'Helpful assistant',
            instructions: 'Help the user.',
            model: 'claude-sonnet-4.5',
            reasoningEffort: 'high',
          },
        },
        { id: 'end', kind: 'end', label: 'End', position: { x: 400, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: 'edge-start-agent', source: 'start', target: 'agent-1', kind: 'direct' },
        { id: 'edge-agent-end', source: 'agent-1', target: 'end', kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
      orchestrationMode: 'single',
      maxIterations: 1,
    },
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
  };
}

describe('dynamic model catalog', () => {
  test('builds the available model list from sidecar capabilities', () => {
    const catalog = buildAvailableModelCatalog(availableModels);

    expect(catalog.map((model) => model.id)).toEqual(['gpt-5.4', 'claude-sonnet-4.5']);
    expect(findModel('claude-sonnet-4.5', catalog)?.supportedReasoningEfforts).toEqual([]);
    expect(findModel('gpt-5.4', catalog)?.defaultReasoningEffort).toBe('medium');
  });

  test('drops unsupported reasoning effort selections for a model', () => {
    const catalog = buildAvailableModelCatalog(availableModels);
    const model = findModel('claude-sonnet-4.5', catalog);

    expect(resolveReasoningEffort(model, 'high')).toBeUndefined();
  });

  test('resolves model references by id or display name', () => {
    const catalog = buildAvailableModelCatalog(availableModels);

    expect(findModelByReference('gpt-5.4', catalog)?.id).toBe('gpt-5.4');
    expect(findModelByReference('Claude Sonnet 4.5', catalog)?.id).toBe('claude-sonnet-4.5');
  });

  test('normalizes workflow agent reasoning effort before runtime execution', () => {
    const normalized = normalizeWorkflowModels(
      createWorkflow(),
      buildAvailableModelCatalog(availableModels),
    );

    const primaryAgent = normalized.graph.nodes.find((node) => node.kind === 'agent');
    expect(primaryAgent?.config.kind === 'agent' ? primaryAgent.config.reasoningEffort : undefined).toBeUndefined();
  });
});
