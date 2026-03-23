import { describe, expect, test } from 'bun:test';

import { getAssistantMessagePhase } from '@renderer/lib/messagePhase';
import type { SessionRecord } from '@shared/domain/session';

function createSession(
  messages: SessionRecord['messages'],
  status: SessionRecord['status'] = 'idle',
): SessionRecord {
  return {
    id: 'session-1',
    projectId: 'project-1',
    patternId: 'pattern-1',
    title: 'Test session',
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    status,
    messages,
    runs: [],
  };
}

describe('assistant message phase', () => {
  test('marks pending assistant messages as thinking', () => {
    const session = createSession([
      {
        id: 'msg-1',
        role: 'assistant',
        authorName: 'Triage',
        content: 'Draft',
        createdAt: '2026-03-23T00:00:00.000Z',
        pending: true,
      },
    ], 'running');

    expect(getAssistantMessagePhase(session, session.messages[0], 0)).toBe('thinking');
  });

  test('marks the last completed assistant message as final when the session is idle', () => {
    const session = createSession([
      {
        id: 'msg-1',
        role: 'assistant',
        authorName: 'Triage',
        content: 'Earlier',
        createdAt: '2026-03-23T00:00:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        authorName: 'UX Specialist',
        content: 'Final answer',
        createdAt: '2026-03-23T00:00:01.000Z',
      },
    ]);

    expect(getAssistantMessagePhase(session, session.messages[0], 0)).toBe('default');
    expect(getAssistantMessagePhase(session, session.messages[1], 1)).toBe('final');
  });

  test('does not mark completed assistant messages as final while the session is still running', () => {
    const session = createSession([
      {
        id: 'msg-1',
        role: 'assistant',
        authorName: 'Triage',
        content: 'In progress',
        createdAt: '2026-03-23T00:00:00.000Z',
      },
    ], 'running');

    expect(getAssistantMessagePhase(session, session.messages[0], 0)).toBe('default');
  });

  test('ignores non-assistant messages', () => {
    const session = createSession([
      {
        id: 'msg-1',
        role: 'user',
        authorName: 'You',
        content: 'Hello',
        createdAt: '2026-03-23T00:00:00.000Z',
      },
    ]);

    expect(getAssistantMessagePhase(session, session.messages[0], 0)).toBe('default');
  });
});
