import type { SidecarModelCapability } from '@shared/contracts/sidecar';
import type { ReasoningEffort, WorkflowDefinition } from '@shared/domain/workflow';

export type ModelProvider = 'openai' | 'anthropic' | 'google';

export interface ModelDefinition {
  id: string;
  name: string;
  provider?: ModelProvider;
  tier?: 'premium' | 'standard' | 'fast';
  supportedReasoningEfforts?: ReadonlyArray<ReasoningEffort>;
  defaultReasoningEffort?: ReasoningEffort;
}

const allReasoningEfforts: ReadonlyArray<ReasoningEffort> = ['low', 'medium', 'high', 'xhigh'];

export const modelCatalog: ReadonlyArray<ModelDefinition> = [
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    tier: 'standard',
    supportedReasoningEfforts: allReasoningEfforts,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 mini',
    provider: 'openai',
    tier: 'fast',
    supportedReasoningEfforts: allReasoningEfforts,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    provider: 'openai',
    tier: 'standard',
    supportedReasoningEfforts: allReasoningEfforts,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2 Codex',
    provider: 'openai',
    tier: 'standard',
    supportedReasoningEfforts: allReasoningEfforts,
    defaultReasoningEffort: 'high',
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    tier: 'standard',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    provider: 'openai',
    tier: 'standard',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT-5.1-Codex',
    provider: 'openai',
    tier: 'standard',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT-5.1-Codex-Max',
    provider: 'openai',
    tier: 'standard',
    supportedReasoningEfforts: allReasoningEfforts,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1-Codex-Mini',
    provider: 'openai',
    tier: 'fast',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 mini',
    provider: 'openai',
    tier: 'fast',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    tier: 'fast',
    supportedReasoningEfforts: [],
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    tier: 'premium',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high',
  },
  {
    id: 'claude-opus-4.6-1m',
    name: 'Claude Opus 4.6 (1M context)(Internal only)',
    provider: 'anthropic',
    tier: 'premium',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high',
  },
  {
    id: 'claude-opus-4.5',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    tier: 'premium',
    supportedReasoningEfforts: [],
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    tier: 'standard',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    tier: 'standard',
    supportedReasoningEfforts: [],
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    tier: 'standard',
    supportedReasoningEfforts: [],
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    tier: 'fast',
    supportedReasoningEfforts: [],
  },
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    provider: 'google',
    tier: 'standard',
    supportedReasoningEfforts: [],
  },
];

const fallbackModelMap = new Map(modelCatalog.map((model) => [model.id, model] as const));

export const providerMeta: ReadonlyArray<{ id: ModelProvider; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
];

export function findModel(
  id: string,
  models: ReadonlyArray<ModelDefinition> = modelCatalog,
): ModelDefinition | undefined {
  return models.find((model) => model.id === id);
}

export function findModelByReference(
  reference: string,
  models: ReadonlyArray<ModelDefinition> = modelCatalog,
): ModelDefinition | undefined {
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return undefined;
  }

  return models.find((model) =>
    model.id === trimmedReference
    || model.name.localeCompare(trimmedReference, undefined, { sensitivity: 'accent' }) === 0);
}

export function inferProvider(modelId: string): ModelProvider | undefined {
  if (modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gemini-')) return 'google';
  return undefined;
}

export function buildAvailableModelCatalog(
  availableModels?: ReadonlyArray<SidecarModelCapability>,
): ReadonlyArray<ModelDefinition> {
  if (!availableModels || availableModels.length === 0) {
    return modelCatalog;
  }

  const providerOrder = new Map(providerMeta.map((provider, index) => [provider.id, index] as const));

  return [...availableModels]
    .map((model) => {
      const fallback = fallbackModelMap.get(model.id);
      const provider = fallback?.provider ?? inferProvider(model.id);

      return {
        id: model.id,
        name: model.name || fallback?.name || model.id,
        provider,
        tier: fallback?.tier,
        supportedReasoningEfforts: model.supportedReasoningEfforts,
        defaultReasoningEffort: model.defaultReasoningEffort,
      } satisfies ModelDefinition;
    })
    .sort((left, right) => {
      const leftProviderOrder =
        left.provider !== undefined
          ? (providerOrder.get(left.provider) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      const rightProviderOrder =
        right.provider !== undefined
          ? (providerOrder.get(right.provider) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      const providerCompare = leftProviderOrder - rightProviderOrder;
      if (providerCompare !== 0) {
        return providerCompare;
      }

      return left.name.localeCompare(right.name);
    });
}

export function getSupportedReasoningEfforts(
  model: ModelDefinition | undefined,
): ReadonlyArray<ReasoningEffort> | undefined {
  return model?.supportedReasoningEfforts;
}

export function resolveReasoningEffort(
  model: ModelDefinition | undefined,
  requested: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  const supported = model?.supportedReasoningEfforts;
  if (!supported) {
    return requested;
  }

  if (supported.length === 0) {
    return undefined;
  }

  if (requested && supported.includes(requested)) {
    return requested;
  }

  if (model?.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }

  return supported[0];
}

export function normalizeWorkflowModels(
  workflow: WorkflowDefinition,
  models: ReadonlyArray<ModelDefinition>,
): WorkflowDefinition {
  return {
    ...workflow,
    graph: {
      ...workflow.graph,
      nodes: workflow.graph.nodes.map((node) => {
        if (node.kind !== 'agent' || node.config.kind !== 'agent') {
          return node;
        }

        const model = findModel(node.config.model, models);
        const reasoningEffort = resolveReasoningEffort(model, node.config.reasoningEffort);
        return reasoningEffort === node.config.reasoningEffort
          ? node
          : {
            ...node,
            config: {
              ...node.config,
              reasoningEffort,
            },
          };
      }),
    },
  };
}
