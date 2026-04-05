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
import type { PendingUserInputRecord } from '@shared/domain/userInput';
import type { PendingPlanReviewRecord } from '@shared/domain/planReview';
import type { PendingMcpAuthRecord } from '@shared/domain/mcpAuth';
import type { ChatMessageAttachment } from '@shared/domain/attachment';
import type { InteractionMode } from '@shared/contracts/sidecar';
import {
  normalizeProjectPromptInvocation,
  type ProjectPromptInvocation,
} from '@shared/domain/projectCustomization';

export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessageKind = 'response' | 'thinking';
export type SessionStatus = 'idle' | 'running' | 'error';
export type SessionTitleSource = 'auto' | 'manual';
export type SessionBranchOriginAction = 'branch' | 'regenerate' | 'edit-and-resend';

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
  messageKind?: ChatMessageKind;
  isPinned?: boolean;
  pending?: boolean;
  attachments?: ChatMessageAttachment[];
  promptInvocation?: ProjectPromptInvocation;
}

export interface SessionBranchOrigin {
  sourceSessionId: string;
  sourceMessageId: string;
  sourceMessageIndex: number;
  branchedAt: string;
  action?: SessionBranchOriginAction;
}

export interface SessionRecord {
  id: string;
  projectId: string;
  patternId: string;
  workflowId?: string;
  title: string;
  titleSource?: SessionTitleSource;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  isPinned?: boolean;
  isArchived?: boolean;
  branchOrigin?: SessionBranchOrigin;
  interactionMode?: InteractionMode;
  cwd?: string;
  messages: ChatMessageRecord[];
  lastError?: string;
  sessionModelConfig?: SessionModelConfig;
  tooling?: SessionToolingSelection;
  approvalSettings?: SessionApprovalSettings;
  pendingApproval?: PendingApprovalRecord;
  pendingApprovalQueue?: PendingApprovalRecord[];
  pendingUserInput?: PendingUserInputRecord;
  pendingPlanReview?: PendingPlanReviewRecord;
  pendingMcpAuth?: PendingMcpAuthRecord;
  runs: SessionRunRecord[];
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeSessionBranchOrigin(
  branchOrigin?: Partial<SessionBranchOrigin>,
): SessionBranchOrigin | undefined {
  const sourceSessionId = normalizeOptionalString(branchOrigin?.sourceSessionId);
  const sourceMessageId = normalizeOptionalString(branchOrigin?.sourceMessageId);
  const branchedAt = normalizeOptionalString(branchOrigin?.branchedAt);
  const sourceMessageIndex = branchOrigin?.sourceMessageIndex;
  const action = branchOrigin?.action;
  const normalizedAction = action === 'branch' || action === 'regenerate' || action === 'edit-and-resend'
    ? action
    : undefined;

  if (
    !sourceSessionId
    || !sourceMessageId
    || !branchedAt
    || typeof sourceMessageIndex !== 'number'
    || !Number.isInteger(sourceMessageIndex)
    || sourceMessageIndex < 0
  ) {
    return undefined;
  }

  return {
    sourceSessionId,
    sourceMessageId,
    sourceMessageIndex,
    branchedAt,
    action: normalizedAction,
  };
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

export function normalizeChatMessageRecord(message: ChatMessageRecord): ChatMessageRecord {
  const normalizedMessage: ChatMessageRecord = {
    ...message,
  };
  const promptInvocation = normalizeProjectPromptInvocation(message.promptInvocation);
  if (promptInvocation) {
    normalizedMessage.promptInvocation = promptInvocation;
  } else {
    delete normalizedMessage.promptInvocation;
  }

  return normalizedMessage;
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
