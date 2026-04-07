import type { SessionRunRecord } from '@shared/domain/runTimeline';
import type { ChatMessageKind } from '@shared/domain/session';

import type {
  QuotaSnapshot,
  ToolCallFileChangePreview,
  WorkflowDiagnosticKind,
  WorkflowDiagnosticSeverity,
} from '@shared/contracts/sidecar';

export type SessionActivityType = 'thinking' | 'tool-calling' | 'handoff' | 'completed';

export type SessionEventKind =
  | 'status'
  | 'message-delta'
  | 'message-complete'
  | 'message-reclassified'
  | 'agent-activity'
  | 'run-updated'
  | 'error'
  | 'subagent'
  | 'skill-invoked'
  | 'hook-lifecycle'
  | 'session-usage'
  | 'session-compaction'
  | 'pending-messages-modified'
  | 'assistant-usage'
  | 'workflow-diagnostic';

export type SubagentEventKind = 'started' | 'completed' | 'failed' | 'selected' | 'deselected';

export interface SessionEventRecord {
  sessionId: string;
  kind: SessionEventKind;
  occurredAt: string;
  status?: 'idle' | 'running' | 'error';
  messageId?: string;
  messageKind?: ChatMessageKind;
  authorName?: string;
  contentDelta?: string;
  content?: string;
  activityType?: SessionActivityType;
  agentId?: string;
  agentName?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: Record<string, unknown>;
  fileChanges?: ToolCallFileChangePreview[];
  run?: SessionRunRecord;
  error?: string;

  // Subagent event fields
  subagentEventKind?: SubagentEventKind;
  customAgentName?: string;
  customAgentDisplayName?: string;
  customAgentDescription?: string;
  subagentError?: string;
  subagentToolCallId?: string;
  subagentModel?: string;

  // Skill invoked fields
  skillName?: string;
  skillPath?: string;
  pluginName?: string;

  // Hook lifecycle fields
  hookInvocationId?: string;
  hookType?: string;
  hookPhase?: 'start' | 'end';
  hookSuccess?: boolean;

  // Session usage fields
  tokenLimit?: number;
  currentTokens?: number;
  messagesLength?: number;

  // Session compaction fields
  compactionPhase?: 'start' | 'complete';
  compactionSuccess?: boolean;
  preCompactionTokens?: number;
  postCompactionTokens?: number;
  tokensRemoved?: number;

  // Assistant usage fields
  usageModel?: string;
  usageInputTokens?: number;
  usageOutputTokens?: number;
  usageCacheReadTokens?: number;
  usageCacheWriteTokens?: number;
  usageCost?: number;
  usageDuration?: number;
  usageTotalNanoAiu?: number;
  usageQuotaSnapshots?: Record<string, QuotaSnapshot>;

  // Workflow diagnostic fields
  diagnosticSeverity?: WorkflowDiagnosticSeverity;
  diagnosticKind?: WorkflowDiagnosticKind;
  diagnosticMessage?: string;
  executorId?: string;
  subworkflowId?: string;
  exceptionType?: string;
}
