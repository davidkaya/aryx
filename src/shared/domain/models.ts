export type ModelProvider = 'openai' | 'anthropic' | 'google';

export interface ModelDefinition {
  id: string;
  name: string;
  provider: ModelProvider;
  tier: 'premium' | 'standard' | 'fast';
}

export const modelCatalog: ModelDefinition[] = [
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', tier: 'standard' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai', tier: 'fast' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'openai', tier: 'standard' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', provider: 'openai', tier: 'standard' },
  { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'openai', tier: 'standard' },
  { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai', tier: 'standard' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', tier: 'fast' },

  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'anthropic', tier: 'premium' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'anthropic', tier: 'standard' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', tier: 'standard' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'fast' },

  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'google', tier: 'standard' },
];

export const providerMeta: { id: ModelProvider; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
];

export function findModel(id: string): ModelDefinition | undefined {
  return modelCatalog.find((m) => m.id === id);
}

export function inferProvider(modelId: string): ModelProvider | undefined {
  if (modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gemini-')) return 'google';
  return undefined;
}
