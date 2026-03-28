import { describe, expect, test } from 'bun:test';

import { applySessionEventWorkspace } from '@renderer/lib/sessionWorkspace';
import type { SessionEventRecord } from '@shared/domain/event';
import type { SessionRunRecord } from '@shared/domain/runTimeline';
import { createWorkspaceSettings } from '@shared/domain/tooling';
import type { WorkspaceState } from '@shared/domain/workspace';

describe('session workspace helpers', () => {
  function createWorkspace(): WorkspaceState {
    return {
      projects: [],
      patterns: [],
      settings: createWorkspaceSettings(),
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
          runs: [],
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
      content: 'Hello',
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
      content: 'Hello world',
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
      content: 'Done',
    } satisfies SessionEventRecord);

    const completed = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'message-complete',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Implementer',
      content: 'Done',
    } satisfies SessionEventRecord);

    expect(completed?.sessions[0].messages[0]).toMatchObject({
      authorName: 'Implementer',
      content: 'Done',
      pending: false,
    });
  });

  test('keeps snapshot-like streamed updates readable while a message is pending', () => {
    const first = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Writer',
      contentDelta: 'How about',
      content: 'How about',
    } satisfies SessionEventRecord);

    const second = applySessionEventWorkspace(first, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Writer',
      contentDelta: 'The **Ashen Crown** feels',
      content: 'How about The **Ashen Crown** feels',
    } satisfies SessionEventRecord);

    const third = applySessionEventWorkspace(second, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:03.000Z',
      messageId: 'assistant-1',
      authorName: 'Writer',
      contentDelta: 'classic and timeless.',
      content: 'How about The **Ashen Crown** feels classic and timeless.',
    } satisfies SessionEventRecord);

    expect(third?.sessions[0].messages[0]).toMatchObject({
      authorName: 'Writer',
      content: 'How about The **Ashen Crown** feels classic and timeless.',
      pending: true,
    });
  });

  test('applies final content from completion events without waiting for a workspace refresh', () => {
    const workspace = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Reviewer',
      contentDelta: 'Draft',
      content: 'Draft',
    } satisfies SessionEventRecord);

    const completed = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'message-complete',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Reviewer',
      content: 'Draft polished into the final review.',
    } satisfies SessionEventRecord);

    expect(completed?.sessions[0].messages[0]).toMatchObject({
      authorName: 'Reviewer',
      content: 'Draft polished into the final review.',
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

  test('applies live run snapshots without waiting for a workspace refresh', () => {
    const run: SessionRunRecord = {
      id: 'run-1',
      requestId: 'turn-1',
      projectId: 'project-1',
      projectPath: 'C:\\workspace\\alpha',
      workspaceKind: 'project',
      patternId: 'pattern-1',
      patternName: 'Sequential Review',
      patternMode: 'sequential',
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
      status: 'running',
      agents: [
        {
          agentId: 'agent-1',
          agentName: 'Writer',
          model: 'gpt-5.4',
        },
      ],
      events: [
        {
          id: 'run-event-1',
          kind: 'run-started',
          occurredAt: '2026-03-23T00:00:01.000Z',
          status: 'completed',
          messageId: 'msg-user-1',
        },
      ],
    };

    const updated = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'run-updated',
      occurredAt: '2026-03-23T00:00:01.000Z',
      run,
    } satisfies SessionEventRecord);

    expect(updated?.sessions[0].runs).toEqual([run]);
  });

  test('auto-completes previous pending assistant messages when a new message starts', () => {
    const first = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Primary Agent',
      contentDelta: 'Exploring the codebase...',
      content: 'Exploring the codebase...',
    } satisfies SessionEventRecord);

    expect(first?.sessions[0].messages).toHaveLength(1);
    expect(first?.sessions[0].messages[0]).toMatchObject({
      id: 'assistant-1',
      pending: true,
    });

    const second = applySessionEventWorkspace(first, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-2',
      authorName: 'Primary Agent',
      contentDelta: 'Still exploring...',
      content: 'Still exploring...',
    } satisfies SessionEventRecord);

    expect(second?.sessions[0].messages).toHaveLength(2);
    expect(second?.sessions[0].messages[0]).toMatchObject({
      id: 'assistant-1',
      content: 'Exploring the codebase...',
      pending: false,
    });
    expect(second?.sessions[0].messages[1]).toMatchObject({
      id: 'assistant-2',
      content: 'Still exploring...',
      pending: true,
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
