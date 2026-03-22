import { describe, expect, test } from 'bun:test';

import type { SidecarModelCapability } from '@shared/contracts/sidecar';
import {
  buildAvailableModelCatalog,
  findModel,
  normalizePatternModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import type { PatternDefinition } from '@shared/domain/pattern';

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

function createPattern(): PatternDefinition {
  return {
    id: 'pattern-1',
    name: 'Pattern',
    description: '',
    mode: 'single',
    availability: 'available',
    maxIterations: 1,
    agents: [
      {
        id: 'agent-1',
        name: 'Primary Agent',
        description: 'Helpful assistant',
        instructions: 'Help the user.',
        model: 'claude-sonnet-4.5',
        reasoningEffort: 'high',
      },
    ],
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

  test('normalizes pattern agents before runtime execution', () => {
    const normalized = normalizePatternModels(
      createPattern(),
      buildAvailableModelCatalog(availableModels),
    );

    expect(normalized.agents[0].reasoningEffort).toBeUndefined();
  });
});
