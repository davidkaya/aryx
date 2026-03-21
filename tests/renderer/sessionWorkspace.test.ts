import { describe, expect, test } from 'bun:test';

import { applySessionEventWorkspace } from '@renderer/lib/sessionWorkspace';
import type { SessionEventRecord } from '@shared/domain/event';
import type { WorkspaceState } from '@shared/domain/workspace';

describe('session workspace helpers', () => {
  function createWorkspace(): WorkspaceState {
    return {
      projects: [],
      patterns: [],
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          patternId: 'pattern-1',
          title: 'Session',
          createdAt: '2026-03-23T00:00:00.000Z',
          updatedAt: '2026-03-23T00:00:00.000Z',
          status: 'idle',
          messages: [],
        },
      ],
      selectedSessionId: 'session-1',
      lastUpdatedAt: '2026-03-23T00:00:00.000Z',
    };
  }

  test('applies message deltas by creating and appending assistant messages', () => {
    const created = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Architect',
      contentDelta: 'Hello',
    } satisfies SessionEventRecord);

    expect(created?.sessions[0].messages).toEqual([
      {
        id: 'assistant-1',
        role: 'assistant',
        authorName: 'Architect',
        content: 'Hello',
        createdAt: '2026-03-23T00:00:01.000Z',
        pending: true,
      },
    ]);

    const appended = applySessionEventWorkspace(created, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Architect',
      contentDelta: ' world',
    } satisfies SessionEventRecord);

    expect(appended?.sessions[0].messages[0]).toMatchObject({
      authorName: 'Architect',
      content: 'Hello world',
      pending: true,
    });
  });

  test('marks streamed messages complete when the session event arrives', () => {
    const workspace = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Implementer',
      contentDelta: 'Done',
    } satisfies SessionEventRecord);

    const completed = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'message-complete',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Implementer',
    } satisfies SessionEventRecord);

    expect(completed?.sessions[0].messages[0]).toMatchObject({
      authorName: 'Implementer',
      content: 'Done',
      pending: false,
    });
  });

  test('updates session status and error state from session events', () => {
    const running = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'status',
      occurredAt: '2026-03-23T00:00:01.000Z',
      status: 'running',
    } satisfies SessionEventRecord);

    expect(running?.sessions[0]).toMatchObject({
      status: 'running',
      lastError: undefined,
    });

    const failed = applySessionEventWorkspace(running, {
      sessionId: 'session-1',
      kind: 'error',
      occurredAt: '2026-03-23T00:00:02.000Z',
      error: 'Boom',
    } satisfies SessionEventRecord);

    expect(failed?.sessions[0]).toMatchObject({
      status: 'error',
      lastError: 'Boom',
    });
  });

  test('ignores events for unknown sessions', () => {
    const workspace = createWorkspace();
    expect(
      applySessionEventWorkspace(workspace, {
        sessionId: 'missing',
        kind: 'message-delta',
        occurredAt: '2026-03-23T00:00:01.000Z',
        messageId: 'assistant-1',
        authorName: 'Architect',
        contentDelta: 'Hello',
      } satisfies SessionEventRecord),
    ).toBe(workspace);
  });
});
