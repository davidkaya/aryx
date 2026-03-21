export type SessionEventKind = 'status' | 'message-delta' | 'message-complete' | 'error';

export interface SessionEventRecord {
  sessionId: string;
  kind: SessionEventKind;
  occurredAt: string;
  status?: 'idle' | 'running' | 'error';
  messageId?: string;
  authorName?: string;
  contentDelta?: string;
  error?: string;
}
