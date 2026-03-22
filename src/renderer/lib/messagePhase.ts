import type { ChatMessageRecord, SessionRecord } from '@shared/domain/session';

export type AssistantMessagePhase = 'default' | 'thinking' | 'final';

export function getAssistantMessagePhase(
  session: SessionRecord,
  message: ChatMessageRecord,
  index: number,
): AssistantMessagePhase {
  if (message.role !== 'assistant') {
    return 'default';
  }

  if (message.pending) {
    return 'thinking';
  }

  if (session.status === 'running') {
    return 'default';
  }

  const lastCompletedAssistantIndex = findLastCompletedAssistantIndex(session.messages);
  return index === lastCompletedAssistantIndex ? 'final' : 'default';
}

function findLastCompletedAssistantIndex(messages: ChatMessageRecord[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.pending) {
      return index;
    }
  }

  return -1;
}
