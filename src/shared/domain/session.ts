import { buildSessionTitle, type PatternDefinition, type ReasoningEffort } from '@shared/domain/pattern';
import {
  createSessionToolingSelection,
  normalizeSessionToolingSelection,
  type SessionToolingSelection,
} from '@shared/domain/tooling';

export type ChatRole = 'system' | 'user' | 'assistant';
export type SessionStatus = 'idle' | 'running' | 'error';
export type SessionTitleSource = 'auto' | 'manual';

export interface ScratchpadSessionConfig {
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ChatMessageRecord {
  id: string;
  role: ChatRole;
  authorName: string;
  content: string;
  createdAt: string;
  pending?: boolean;
}

export interface SessionRecord {
  id: string;
  projectId: string;
  patternId: string;
  title: string;
  titleSource?: SessionTitleSource;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  isPinned?: boolean;
  isArchived?: boolean;
  messages: ChatMessageRecord[];
  lastError?: string;
  scratchpadConfig?: ScratchpadSessionConfig;
  tooling?: SessionToolingSelection;
}

export function resolveSessionTitle(
  session: Pick<SessionRecord, 'title' | 'titleSource'>,
  pattern: PatternDefinition,
  messages: ChatMessageRecord[],
): string {
  if (session.titleSource === 'manual') {
    return session.title;
  }

  return buildSessionTitle(pattern, messages);
}

export function createScratchpadSessionConfig(
  pattern: PatternDefinition,
): ScratchpadSessionConfig | undefined {
  const primaryAgent = pattern.agents[0];
  if (!primaryAgent) {
    return undefined;
  }

  return {
    model: primaryAgent.model,
    reasoningEffort: primaryAgent.reasoningEffort,
  };
}

export function resolveSessionToolingSelection(
  session: Pick<SessionRecord, 'tooling'>,
): SessionToolingSelection {
  return normalizeSessionToolingSelection(session.tooling ?? createSessionToolingSelection());
}

export function resolveScratchpadSessionConfig(
  session: SessionRecord,
  pattern: PatternDefinition,
): ScratchpadSessionConfig | undefined {
  const defaults = createScratchpadSessionConfig(pattern);
  if (!defaults) {
    return undefined;
  }

  const overrideModel = session.scratchpadConfig?.model.trim();
  return {
    model: overrideModel || defaults.model,
    reasoningEffort: session.scratchpadConfig?.reasoningEffort ?? defaults.reasoningEffort,
  };
}

export function applyScratchpadSessionConfig(
  pattern: PatternDefinition,
  session: SessionRecord,
): PatternDefinition {
  const config = resolveScratchpadSessionConfig(session, pattern);
  const primaryAgent = pattern.agents[0];
  if (!config || !primaryAgent) {
    return pattern;
  }

  return {
    ...pattern,
    agents: [
      {
        ...primaryAgent,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
      },
      ...pattern.agents.slice(1),
    ],
  };
}
