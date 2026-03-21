export type ChatRole = 'system' | 'user' | 'assistant';
export type SessionStatus = 'idle' | 'running' | 'error';

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
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  messages: ChatMessageRecord[];
  lastError?: string;
}
