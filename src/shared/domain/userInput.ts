export type UserInputStatus = 'pending' | 'answered';

export interface PendingUserInputRecord {
  id: string;
  status: UserInputStatus;
  agentId?: string;
  agentName?: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
  requestedAt: string;
  answer?: string;
  answeredAt?: string;
}
