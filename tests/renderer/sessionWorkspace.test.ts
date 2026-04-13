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
      workflows: [],
      workflowTemplates: [],
      settings: createWorkspaceSettings(),
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workflowId: 'workflow-1',
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
      workflowId: 'workflow-1',
      workflowName: 'Sequential Review',
      workflowMode: 'sequential',
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

  test('reclassifies a message as thinking when message-reclassified event arrives', () => {
    const workspace = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Primary Agent',
      contentDelta: 'Let me search...',
      content: 'Let me search...',
    } satisfies SessionEventRecord);

    const reclassified = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'message-reclassified',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      messageKind: 'thinking',
    } satisfies SessionEventRecord);

    expect(reclassified?.sessions[0].messages[0]).toMatchObject({
      id: 'assistant-1',
      messageKind: 'thinking',
    });
  });

  test('ignores message-reclassified for an already reclassified message', () => {
    let workspace = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Primary Agent',
      contentDelta: 'Let me search...',
      content: 'Let me search...',
    } satisfies SessionEventRecord);

    workspace = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'message-reclassified',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      messageKind: 'thinking',
    } satisfies SessionEventRecord);

    const duplicate = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'message-reclassified',
      occurredAt: '2026-03-23T00:00:03.000Z',
      messageId: 'assistant-1',
      messageKind: 'thinking',
    } satisfies SessionEventRecord);

    // Should return the same reference (no change)
    expect(duplicate).toBe(workspace);
  });

  test('ignores message-reclassified for unknown message ids', () => {
    const workspace = createWorkspace();
    const result = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'message-reclassified',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'nonexistent',
      messageKind: 'thinking',
    } satisfies SessionEventRecord);

    expect(result).toBe(workspace);
  });

  test('uses resolved content from main process and falls back to simple append', () => {
    // When content is present (main process resolved it), use it directly
    const first = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      contentDelta: 'Hello',
      content: 'Hello',
    } satisfies SessionEventRecord);

    // Main process sends full resolved content on every delta
    const second = applySessionEventWorkspace(first, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      contentDelta: ' world',
      content: 'Hello world',
    } satisfies SessionEventRecord);

    expect(second?.sessions[0].messages[0].content).toBe('Hello world');

    // Backward compat: if content is missing, simple append of contentDelta
    const fallback = applySessionEventWorkspace(second, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:03.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      contentDelta: '!',
    } satisfies SessionEventRecord);

    expect(fallback?.sessions[0].messages[0].content).toBe('Hello world!');
  });

  test('sets currentIntent from assistant-intent events', () => {
    const workspace = createWorkspace();
    const updated = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'assistant-intent',
      occurredAt: '2026-03-23T00:00:01.000Z',
      intent: 'Exploring codebase',
    } satisfies SessionEventRecord);

    expect(updated?.sessions[0].currentIntent).toBe('Exploring codebase');
  });

  test('clears currentIntent when session transitions to idle', () => {
    let workspace = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'status',
      occurredAt: '2026-03-23T00:00:01.000Z',
      status: 'running',
    } satisfies SessionEventRecord);

    workspace = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'assistant-intent',
      occurredAt: '2026-03-23T00:00:02.000Z',
      intent: 'Writing tests',
    } satisfies SessionEventRecord);

    expect(workspace?.sessions[0].currentIntent).toBe('Writing tests');

    workspace = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'status',
      occurredAt: '2026-03-23T00:00:03.000Z',
      status: 'idle',
    } satisfies SessionEventRecord);

    expect(workspace?.sessions[0].currentIntent).toBeUndefined();
  });

  test('ignores duplicate assistant-intent events', () => {
    const workspace = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'assistant-intent',
      occurredAt: '2026-03-23T00:00:01.000Z',
      intent: 'Exploring codebase',
    } satisfies SessionEventRecord);

    const duplicate = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'assistant-intent',
      occurredAt: '2026-03-23T00:00:02.000Z',
      intent: 'Exploring codebase',
    } satisfies SessionEventRecord);

    expect(duplicate).toBe(workspace);
  });

  test('preserves currentIntent when status changes to running', () => {
    let workspace = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'assistant-intent',
      occurredAt: '2026-03-23T00:00:01.000Z',
      intent: 'Analyzing code',
    } satisfies SessionEventRecord);

    workspace = applySessionEventWorkspace(workspace, {
      sessionId: 'session-1',
      kind: 'status',
      occurredAt: '2026-03-23T00:00:02.000Z',
      status: 'running',
    } satisfies SessionEventRecord);

    expect(workspace?.sessions[0].currentIntent).toBe('Analyzing code');
  });

  /* ── Streaming regression tests ──────────────────────────── */

  test('thinking-to-response transition: reclassified message stays hidden, new message becomes final', () => {
    // Step 1: first message streams as normal assistant content
    let ws = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      contentDelta: 'Let me look into this...',
      content: 'Let me look into this...',
    } satisfies SessionEventRecord);

    // Step 2: reclassified as thinking (the agent decided to search first)
    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'message-reclassified',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      messageKind: 'thinking',
    } satisfies SessionEventRecord);

    expect(ws?.sessions[0].messages[0]).toMatchObject({
      id: 'assistant-1',
      messageKind: 'thinking',
      pending: true,
    });

    // Step 3: a new actual response message starts streaming
    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:03.000Z',
      messageId: 'assistant-2',
      authorName: 'Agent',
      contentDelta: 'Here is the answer.',
      content: 'Here is the answer.',
    } satisfies SessionEventRecord);

    // The thinking message should be auto-completed, new one is pending
    expect(ws?.sessions[0].messages).toHaveLength(2);
    expect(ws?.sessions[0].messages[0]).toMatchObject({
      id: 'assistant-1',
      messageKind: 'thinking',
      pending: false,
    });
    expect(ws?.sessions[0].messages[1]).toMatchObject({
      id: 'assistant-2',
      content: 'Here is the answer.',
      pending: true,
    });
  });

  test('concurrent multi-message streaming keeps messages independent', () => {
    // Two different assistant messages stream interleaved (e.g. multi-agent)
    let ws = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'msg-agent-a',
      authorName: 'Architect',
      contentDelta: 'Design: ',
      content: 'Design: ',
    } satisfies SessionEventRecord);

    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'msg-agent-a',
      authorName: 'Architect',
      contentDelta: 'Use modules.',
      content: 'Design: Use modules.',
    } satisfies SessionEventRecord);

    // Complete one message, verify others are unaffected
    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'message-complete',
      occurredAt: '2026-03-23T00:00:04.000Z',
      messageId: 'msg-agent-a',
      authorName: 'Architect',
      content: 'Design: Use modules.',
    } satisfies SessionEventRecord);

    expect(ws?.sessions[0].messages).toHaveLength(1);
    expect(ws?.sessions[0].messages[0]).toMatchObject({
      id: 'msg-agent-a',
      content: 'Design: Use modules.',
      pending: false,
    });
  });

  test('run-updated replaces existing run by id and handles new runs', () => {
    const runV1: SessionRunRecord = {
      id: 'run-1',
      requestId: 'turn-1',
      projectId: 'project-1',
      projectPath: 'C:\\workspace',
      workspaceKind: 'project',
      workflowId: 'workflow-1',
      workflowName: 'Review',
      workflowMode: 'sequential',
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
      status: 'running',
      agents: [],
      events: [],
    };

    let ws = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'run-updated',
      occurredAt: '2026-03-23T00:00:01.000Z',
      run: runV1,
    } satisfies SessionEventRecord);

    expect(ws?.sessions[0].runs).toHaveLength(1);
    expect(ws?.sessions[0].runs[0].status).toBe('running');

    // Run updated with new status and events
    const runV2: SessionRunRecord = {
      ...runV1,
      status: 'completed',
      events: [
        {
          id: 'evt-1',
          kind: 'run-started',
          occurredAt: '2026-03-23T00:00:01.000Z',
          status: 'completed',
        },
      ],
    };

    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'run-updated',
      occurredAt: '2026-03-23T00:00:02.000Z',
      run: runV2,
    } satisfies SessionEventRecord);

    // Should replace, not duplicate
    expect(ws?.sessions[0].runs).toHaveLength(1);
    expect(ws?.sessions[0].runs[0].status).toBe('completed');
    expect(ws?.sessions[0].runs[0].events).toHaveLength(1);
  });

  test('full turn lifecycle: intent → deltas → complete → idle clears intent', () => {
    let ws = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'status',
      occurredAt: '2026-03-23T00:00:00.000Z',
      status: 'running',
    } satisfies SessionEventRecord);

    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'assistant-intent',
      occurredAt: '2026-03-23T00:00:01.000Z',
      intent: 'Exploring codebase',
    } satisfies SessionEventRecord);

    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      contentDelta: 'Found the issue.',
      content: 'Found the issue.',
    } satisfies SessionEventRecord);

    // Intent survives during message streaming
    expect(ws?.sessions[0].currentIntent).toBe('Exploring codebase');
    expect(ws?.sessions[0].messages[0].pending).toBe(true);

    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'assistant-intent',
      occurredAt: '2026-03-23T00:00:03.000Z',
      intent: 'Fixing bug',
    } satisfies SessionEventRecord);

    expect(ws?.sessions[0].currentIntent).toBe('Fixing bug');

    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'message-complete',
      occurredAt: '2026-03-23T00:00:04.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      content: 'Found the issue. Here is the fix.',
    } satisfies SessionEventRecord);

    // Intent still active until idle
    expect(ws?.sessions[0].currentIntent).toBe('Fixing bug');

    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'status',
      occurredAt: '2026-03-23T00:00:05.000Z',
      status: 'idle',
    } satisfies SessionEventRecord);

    expect(ws?.sessions[0].currentIntent).toBeUndefined();
    expect(ws?.sessions[0].status).toBe('idle');
    expect(ws?.sessions[0].messages[0].content).toBe('Found the issue. Here is the fix.');
    expect(ws?.sessions[0].messages[0].pending).toBe(false);
  });

  test('message-complete content overrides previously streamed content', () => {
    let ws = applySessionEventWorkspace(createWorkspace(), {
      sessionId: 'session-1',
      kind: 'message-delta',
      occurredAt: '2026-03-23T00:00:01.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      contentDelta: 'Partial draft...',
      content: 'Partial draft...',
    } satisfies SessionEventRecord);

    // Backend sends final authoritative content on completion
    ws = applySessionEventWorkspace(ws, {
      sessionId: 'session-1',
      kind: 'message-complete',
      occurredAt: '2026-03-23T00:00:02.000Z',
      messageId: 'assistant-1',
      authorName: 'Agent',
      content: 'The complete, polished final answer with all details.',
    } satisfies SessionEventRecord);

    expect(ws?.sessions[0].messages[0]).toMatchObject({
      content: 'The complete, polished final answer with all details.',
      pending: false,
    });
  });
});
