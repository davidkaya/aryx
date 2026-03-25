import { buildSessionTitle, type PatternDefinition, type ReasoningEffort } from '@shared/domain/pattern';
import {
  createSessionToolingSelection,
  normalizeSessionToolingSelection,
  type SessionToolingSelection,
} from '@shared/domain/tooling';
import {
  normalizeSessionApprovalSettings,
  resolveEffectiveApprovalPolicy,
  type PendingApprovalRecord,
  type SessionApprovalSettings,
} from '@shared/domain/approval';
import type { SessionRunRecord } from '@shared/domain/runTimeline';

export type ChatRole = 'system' | 'user' | 'assistant';
export type SessionStatus = 'idle' | 'running' | 'error';
export type SessionTitleSource = 'auto' | 'manual';

export interface SessionModelConfig {
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
  sessionModelConfig?: SessionModelConfig;
  tooling?: SessionToolingSelection;
  approvalSettings?: SessionApprovalSettings;
  pendingApproval?: PendingApprovalRecord;
  pendingApprovalQueue?: PendingApprovalRecord[];
  runs: SessionRunRecord[];
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

export function createSessionModelConfig(
  pattern: PatternDefinition,
): SessionModelConfig | undefined {
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

export function resolveSessionApprovalSettings(
  session: Pick<SessionRecord, 'approvalSettings'>,
): SessionApprovalSettings | undefined {
  return normalizeSessionApprovalSettings(session.approvalSettings);
}

export function resolveSessionModelConfig(
  session: SessionRecord,
  pattern: PatternDefinition,
): SessionModelConfig | undefined {
  const defaults = createSessionModelConfig(pattern);
  if (!defaults) {
    return undefined;
  }

  const overrideModel = session.sessionModelConfig?.model.trim();
  return {
    model: overrideModel || defaults.model,
    reasoningEffort: session.sessionModelConfig?.reasoningEffort ?? defaults.reasoningEffort,
  };
}

export function applySessionModelConfig(
  pattern: PatternDefinition,
  session: SessionRecord,
): PatternDefinition {
  const config = resolveSessionModelConfig(session, pattern);
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

export function applySessionApprovalSettings(
  pattern: PatternDefinition,
  session: Pick<SessionRecord, 'approvalSettings'>,
): PatternDefinition {
  if (session.approvalSettings === undefined) {
    return pattern;
  }

  return {
    ...pattern,
    approvalPolicy: resolveEffectiveApprovalPolicy(pattern.approvalPolicy, session.approvalSettings),
  };
}
