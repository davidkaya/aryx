export type SessionActivityType = 'thinking' | 'tool-calling' | 'handoff' | 'completed';

export type SessionEventKind =
  | 'status'
  | 'message-delta'
  | 'message-complete'
  | 'agent-activity'
  | 'error';

export interface SessionEventRecord {
  sessionId: string;
  kind: SessionEventKind;
  occurredAt: string;
  status?: 'idle' | 'running' | 'error';
  messageId?: string;
  authorName?: string;
  contentDelta?: string;
  activityType?: SessionActivityType;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  error?: string;
}
