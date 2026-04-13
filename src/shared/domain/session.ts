import {
  normalizeSessionApprovalSettings,
  resolveEffectiveApprovalPolicy,
  type PendingApprovalRecord,
  type SessionApprovalSettings,
} from '@shared/domain/approval';
import type { ChatMessageAttachment } from '@shared/domain/attachment';
import type { PendingMcpAuthRecord } from '@shared/domain/mcpAuth';
import type { PendingPlanReviewRecord } from '@shared/domain/planReview';
import {
  normalizeProjectPromptInvocation,
  type ProjectPromptInvocation,
} from '@shared/domain/projectCustomization';
import type { SessionRunRecord } from '@shared/domain/runTimeline';
import {
  createSessionToolingSelection,
  normalizeSessionToolingSelection,
  type SessionToolingSelection,
} from '@shared/domain/tooling';
import type { PendingUserInputRecord } from '@shared/domain/userInput';
import {
  buildWorkflowExecutionDefinition,
  resolveWorkflowAgentNodes,
  type ReasoningEffort,
  type WorkflowDefinition,
  type WorkflowResolutionOptions,
} from '@shared/domain/workflow';
import type { InteractionMode } from '@shared/contracts/sidecar';
import { buildMarkdownExcerpt } from '@shared/utils/markdownText';

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
  workflowId: string;
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
  currentIntent?: string;
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
  workflow: Pick<WorkflowDefinition, 'name'>,
  messages: ChatMessageRecord[],
): string {
  if (session.titleSource === 'manual') {
    return session.title;
  }

  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) {
    return workflow.name;
  }

  return buildMarkdownExcerpt(firstUserMessage.content, 48) ?? workflow.name;
}

export function createSessionModelConfig(
  workflow: WorkflowDefinition,
  options?: WorkflowResolutionOptions,
): SessionModelConfig | undefined {
  const primaryAgent = buildWorkflowExecutionDefinition(workflow, options).agents[0];
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
  workflow: WorkflowDefinition,
): SessionModelConfig | undefined {
  const defaults = createSessionModelConfig(workflow);
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
  workflow: WorkflowDefinition,
  session: SessionRecord,
): WorkflowDefinition {
  const config = resolveSessionModelConfig(session, workflow);
  if (!config) {
    return workflow;
  }

  let applied = false;
  const nodes = workflow.graph.nodes.map((node, index) => {
    if (applied || node.kind !== 'agent' || node.config.kind !== 'agent') {
      return node;
    }

    applied = true;
    return {
      ...node,
      config: {
        ...node.config,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
      },
    };
  });

  return applied
    ? {
      ...workflow,
      graph: {
        ...workflow.graph,
        nodes,
      },
    }
    : workflow;
}

export function applySessionApprovalSettings(
  workflow: WorkflowDefinition,
  session: Pick<SessionRecord, 'approvalSettings'>,
): WorkflowDefinition {
  if (session.approvalSettings === undefined) {
    return workflow;
  }

  const execution = buildWorkflowExecutionDefinition(workflow);
  return {
    ...workflow,
    settings: {
      ...workflow.settings,
      approvalPolicy: resolveEffectiveApprovalPolicy(execution.approvalPolicy, session.approvalSettings),
    },
  };
}
