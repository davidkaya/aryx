import type { ChatMessageRecord, SessionRecord } from '@shared/domain/session';

export type AssistantMessagePhase = 'default' | 'thinking' | 'final';

export function getAssistantMessagePhase(
  session: SessionRecord,
  message: ChatMessageRecord,
): AssistantMessagePhase {
  if (message.role !== 'assistant') {
    return 'default';
  }

  if (message.messageKind === 'thinking') {
    return 'default';
  }

  if (message.pending) {
    return 'thinking';
  }

  if (session.status === 'running') {
    return 'default';
  }

  const lastId = findLastCompletedAssistantId(session.messages);
  return message.id === lastId ? 'final' : 'default';
}

function findLastCompletedAssistantId(messages: ChatMessageRecord[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.pending && message.messageKind !== 'thinking') {
      return message.id;
    }
  }

  return undefined;
}
