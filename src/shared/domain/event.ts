import type { SessionRunRecord } from '@shared/domain/runTimeline';

export type SessionActivityType = 'thinking' | 'tool-calling' | 'handoff' | 'completed';

export type SessionEventKind =
  | 'status'
  | 'message-delta'
  | 'message-complete'
  | 'agent-activity'
  | 'run-updated'
  | 'error';

export interface SessionEventRecord {
  sessionId: string;
  kind: SessionEventKind;
  occurredAt: string;
  status?: 'idle' | 'running' | 'error';
  messageId?: string;
  authorName?: string;
  contentDelta?: string;
  content?: string;
  activityType?: SessionActivityType;
  agentId?: string;
  agentName?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  toolName?: string;
  run?: SessionRunRecord;
  error?: string;
}
