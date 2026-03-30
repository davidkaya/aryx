import type { SessionEventRecord } from '@shared/domain/event';
import { upsertSessionRunRecord } from '@shared/domain/runTimeline';
import type { ChatMessageRecord, SessionRecord } from '@shared/domain/session';
import type { WorkspaceState } from '@shared/domain/workspace';
import { mergeStreamingText } from '@shared/utils/streamingText';

export function applySessionEventWorkspace(
  current: WorkspaceState | undefined,
  event: SessionEventRecord,
): WorkspaceState | undefined {
  if (!current) {
    return current;
  }

  const sessionIndex = current.sessions.findIndex((session) => session.id === event.sessionId);
  if (sessionIndex < 0) {
    return current;
  }

  const session = current.sessions[sessionIndex];
  const nextSession = applySessionEvent(session, event);
  if (nextSession === session) {
    return current;
  }

  const nextSessions = current.sessions.slice();
  nextSessions[sessionIndex] = nextSession;
  return {
    ...current,
    sessions: nextSessions,
  };
}

function applySessionEvent(session: SessionRecord, event: SessionEventRecord): SessionRecord {
  switch (event.kind) {
    case 'status':
      return applyStatusEvent(session, event);
    case 'error':
      return applyErrorEvent(session, event);
    case 'message-delta':
      return applyMessageDeltaEvent(session, event);
    case 'message-complete':
      return applyMessageCompleteEvent(session, event);
    case 'message-reclassified':
      return applyMessageReclassifiedEvent(session, event);
    case 'run-updated':
      return applyRunUpdatedEvent(session, event);
    default:
      return session;
  }
}

function applyStatusEvent(session: SessionRecord, event: SessionEventRecord): SessionRecord {
  if (!event.status) {
    return session;
  }

  if (session.status === event.status && (event.status === 'error' || !session.lastError)) {
    return session;
  }

  return {
    ...session,
    status: event.status,
    lastError: event.status === 'error' ? session.lastError : undefined,
    updatedAt: event.occurredAt,
  };
}

function applyErrorEvent(session: SessionRecord, event: SessionEventRecord): SessionRecord {
  const error = event.error?.trim();
  if (session.status === 'error' && session.lastError === error) {
    return session;
  }

  return {
    ...session,
    status: 'error',
    lastError: error,
    updatedAt: event.occurredAt,
  };
}

function applyMessageDeltaEvent(session: SessionRecord, event: SessionEventRecord): SessionRecord {
  if (!event.messageId || (event.content === undefined && event.contentDelta === undefined)) {
    return session;
  }

  const resolvedContent = event.content ?? event.contentDelta ?? '';
  const messageIndex = session.messages.findIndex((message) => message.id === event.messageId);
  if (messageIndex >= 0) {
    const existing = session.messages[messageIndex];
    const nextMessage: ChatMessageRecord = {
      ...existing,
      authorName: event.authorName ?? existing.authorName,
      content: event.content ?? mergeStreamingText(existing.content, resolvedContent),
      pending: true,
    };

    if (
      nextMessage.authorName === existing.authorName
      && nextMessage.content === existing.content
      && existing.pending
    ) {
      return session;
    }

    const nextMessages = session.messages.slice();
    nextMessages[messageIndex] = nextMessage;
    return {
      ...session,
      messages: nextMessages,
      updatedAt: event.occurredAt,
    };
  }

  // Auto-complete any previously pending assistant messages so only
  // the new message shows the "Thinking" indicator.
  const completedMessages = session.messages.map((message) =>
    message.pending && message.role === 'assistant'
      ? { ...message, pending: false }
      : message,
  );

  return {
    ...session,
    messages: [
      ...completedMessages,
        {
          id: event.messageId,
          role: 'assistant',
          authorName: event.authorName ?? 'assistant',
          content: resolvedContent,
          createdAt: event.occurredAt,
          pending: true,
        },
    ],
    updatedAt: event.occurredAt,
  };
}

function applyMessageCompleteEvent(session: SessionRecord, event: SessionEventRecord): SessionRecord {
  if (!event.messageId) {
    return session;
  }

  const messageIndex = session.messages.findIndex((message) => message.id === event.messageId);
  if (messageIndex < 0) {
    return session;
  }

  const existing = session.messages[messageIndex];
  const nextMessage: ChatMessageRecord = {
    ...existing,
    authorName: event.authorName ?? existing.authorName,
    content: event.content ?? existing.content,
    pending: false,
  };

  if (
    nextMessage.authorName === existing.authorName
    && nextMessage.content === existing.content
    && !existing.pending
  ) {
    return session;
  }

  const nextMessages = session.messages.slice();
  nextMessages[messageIndex] = nextMessage;
  return {
    ...session,
    messages: nextMessages,
    updatedAt: event.occurredAt,
  };
}

function applyMessageReclassifiedEvent(session: SessionRecord, event: SessionEventRecord): SessionRecord {
  if (!event.messageId || !event.messageKind) {
    return session;
  }

  const messageIndex = session.messages.findIndex((message) => message.id === event.messageId);
  if (messageIndex < 0) {
    return session;
  }

  const existing = session.messages[messageIndex];
  if (existing.messageKind === event.messageKind) {
    return session;
  }

  const nextMessages = session.messages.slice();
  nextMessages[messageIndex] = { ...existing, messageKind: event.messageKind };
  return {
    ...session,
    messages: nextMessages,
    updatedAt: event.occurredAt,
  };
}

function applyRunUpdatedEvent(session: SessionRecord, event: SessionEventRecord): SessionRecord {
  if (!event.run) {
    return session;
  }

  const nextRuns = upsertSessionRunRecord(session.runs, event.run);
  if (
    nextRuns.length === session.runs.length
    && nextRuns.every((run, index) => run === session.runs[index])
  ) {
    return session;
  }

  return {
    ...session,
    runs: nextRuns,
    updatedAt: event.occurredAt,
  };
}
