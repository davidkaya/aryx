import { describe, expect, test } from 'bun:test';

import type { WorkflowDefinition } from '@shared/domain/workflow';
import {
  appendRunActivityEvent,
  completeSessionRunRecord,
  createSessionRunRecord,
  normalizeSessionRunRecords,
  upsertRunApprovalEvent,
  upsertRunMessageEvent,
} from '@shared/domain/runTimeline';
import type { SessionRunRecord } from '@shared/domain/runTimeline';
import type { ProjectRecord } from '@shared/domain/project';
import type { PendingApprovalRecord } from '@shared/domain/approval';

function createWorkflow(): WorkflowDefinition {
  return {
    id: 'workflow-sequential',
    name: 'Sequential Trio Review',
    description: 'Sequential handoff review flow.',
    graph: {
      nodes: [
        { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
        {
          id: 'agent-writer',
          kind: 'agent',
          label: 'Writer',
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: 'agent-writer',
            name: 'Writer',
            description: 'Writes the draft.',
            instructions: 'Write.',
            model: 'gpt-5.4',
          },
        },
        {
          id: 'agent-reviewer',
          kind: 'agent',
          label: 'Reviewer',
          position: { x: 400, y: 0 },
          order: 1,
          config: {
            kind: 'agent',
            id: 'agent-reviewer',
            name: 'Reviewer',
            description: 'Reviews the draft.',
            instructions: 'Review.',
            model: 'claude-sonnet-4.5',
          },
        },
        { id: 'end', kind: 'end', label: 'End', position: { x: 600, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: 'edge-start-writer', source: 'start', target: 'agent-writer', kind: 'direct' },
        { id: 'edge-writer-reviewer', source: 'agent-writer', target: 'agent-reviewer', kind: 'direct' },
        { id: 'edge-reviewer-end', source: 'agent-reviewer', target: 'end', kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
      orchestrationMode: 'sequential',
      maxIterations: 1,
    },
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
  };
}

function createProject(): ProjectRecord {
  return {
    id: 'project-1',
    name: 'alpha',
    path: 'C:\\workspace\\alpha',
    addedAt: '2026-03-23T00:00:00.000Z',
  };
}

describe('run timeline helpers', () => {
  test('creates a persistent run record with agent lanes and a trigger event', () => {
    const run = createSessionRunRecord({
      requestId: 'turn-1',
      project: createProject(),
      workingDirectory: 'C:\\workspace\\alpha\\packages\\app',
      workspaceKind: 'project',
      workflow: createWorkflow(),
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
      preRunGitBaselineFiles: [
        {
          path: 'src\\alpha.ts',
          combinedDiff: '@@ -1 +1 @@\n-old\n+new\n',
        },
      ],
    });

    expect(run).toMatchObject({
      requestId: 'turn-1',
      projectId: 'project-1',
      projectPath: 'C:\\workspace\\alpha',
      workingDirectory: 'C:\\workspace\\alpha\\packages\\app',
      workflowId: 'workflow-sequential',
      workflowName: 'Sequential Trio Review',
      workflowMode: 'sequential',
      triggerMessageId: 'msg-user-1',
      status: 'running',
    });
    expect(run.preRunGitBaselineFiles).toEqual([
      {
        path: 'src\\alpha.ts',
        previousPath: undefined,
        combinedDiff: '@@ -1 +1 @@\n-old\n+new\n',
      },
    ]);
    expect(run.agents).toEqual([
      {
        agentId: 'agent-writer',
        agentName: 'Writer',
        model: 'gpt-5.4',
        reasoningEffort: undefined,
      },
      {
        agentId: 'agent-reviewer',
        agentName: 'Reviewer',
        model: 'claude-sonnet-4.5',
        reasoningEffort: undefined,
      },
    ]);
    expect(run.events[0]).toMatchObject({
      kind: 'run-started',
      status: 'completed',
      messageId: 'msg-user-1',
    });
  });

  test('records grouped message steps and settles the run on completion', () => {
    const baseRun = createSessionRunRecord({
      requestId: 'turn-1',
      project: createProject(),
      workspaceKind: 'project',
      workflow: createWorkflow(),
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
    });

    const streamingRun = upsertRunMessageEvent(baseRun, {
      messageId: 'msg-assistant-1',
      authorName: 'Writer',
      content: 'Draft',
      occurredAt: '2026-03-23T00:00:02.000Z',
      status: 'running',
    });

    const completedRun = completeSessionRunRecord(
      upsertRunMessageEvent(streamingRun, {
        messageId: 'msg-assistant-1',
        authorName: 'Writer',
        content: 'Draft polished into the final answer.',
        occurredAt: '2026-03-23T00:00:03.000Z',
        status: 'completed',
      }),
      '2026-03-23T00:00:04.000Z',
    );

    const messageEvent = completedRun.events.find((event) => event.kind === 'message');
    expect(messageEvent).toMatchObject({
      messageId: 'msg-assistant-1',
      agentId: 'agent-writer',
      agentName: 'Writer',
      content: 'Draft polished into the final answer.',
      status: 'completed',
      updatedAt: '2026-03-23T00:00:03.000Z',
    });
    expect(completedRun.status).toBe('completed');
    expect(completedRun.completedAt).toBe('2026-03-23T00:00:04.000Z');
    expect(completedRun.events.at(-1)).toMatchObject({
      kind: 'run-completed',
      status: 'completed',
    });
  });

  test('captures handoffs with explicit source and target agents', () => {
    const run = appendRunActivityEvent(
      createSessionRunRecord({
        requestId: 'turn-1',
        project: createProject(),
        workspaceKind: 'project',
        workflow: createWorkflow(),
        triggerMessageId: 'msg-user-1',
        startedAt: '2026-03-23T00:00:01.000Z',
      }),
      {
        activityType: 'handoff',
        occurredAt: '2026-03-23T00:00:02.000Z',
        sourceAgentId: 'agent-writer',
        agentId: 'agent-reviewer',
      },
    );

    expect(run.events.at(-1)).toMatchObject({
      kind: 'handoff',
      agentId: 'agent-writer',
      agentName: 'Writer',
      sourceAgentId: 'agent-writer',
      sourceAgentName: 'Writer',
      targetAgentId: 'agent-reviewer',
      targetAgentName: 'Reviewer',
    });
  });

  test('merges file change previews into a single tool-call event by toolCallId', () => {
    const baseRun = createSessionRunRecord({
      requestId: 'turn-1',
      project: createProject(),
      workspaceKind: 'project',
      workflow: createWorkflow(),
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
    });

    const startedRun = appendRunActivityEvent(baseRun, {
      activityType: 'tool-calling',
      occurredAt: '2026-03-23T00:00:02.000Z',
      agentId: 'agent-writer',
      toolName: 'apply_patch',
      toolCallId: 'tool-call-1',
    });

    const firstPreviewRun = appendRunActivityEvent(startedRun, {
      activityType: 'tool-calling',
      occurredAt: '2026-03-23T00:00:03.000Z',
      agentId: 'agent-writer',
      toolName: 'apply_patch',
      toolCallId: 'tool-call-1',
      fileChanges: [{ path: 'src\\alpha.ts', diff: '@@ -1 +1 @@' }],
    });

    const mergedRun = appendRunActivityEvent(firstPreviewRun, {
      activityType: 'tool-calling',
      occurredAt: '2026-03-23T00:00:04.000Z',
      agentId: 'agent-writer',
      toolCallId: 'tool-call-1',
      fileChanges: [{ path: 'src\\beta.ts', newFileContents: 'export const beta = true;\n' }],
    });

    const toolCallEvents = mergedRun.events.filter((event) => event.kind === 'tool-call');
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0]).toMatchObject({
      agentId: 'agent-writer',
      agentName: 'Writer',
      toolName: 'apply_patch',
      toolCallId: 'tool-call-1',
      occurredAt: '2026-03-23T00:00:02.000Z',
      updatedAt: '2026-03-23T00:00:04.000Z',
    });
    expect(toolCallEvents[0].fileChanges).toEqual([
      { path: 'src\\alpha.ts', diff: '@@ -1 +1 @@' },
      { path: 'src\\beta.ts', newFileContents: 'export const beta = true;\n' },
    ]);
  });

  test('normalizes missing run collections to an empty array', () => {
    expect(normalizeSessionRunRecords(undefined)).toEqual([]);
  });

  test('preserves toolArguments through normalization round-trip', () => {
    const baseRun = createSessionRunRecord({
      requestId: 'turn-1',
      project: createProject(),
      workspaceKind: 'project',
      workflow: createWorkflow(),
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
    });

    const run = appendRunActivityEvent(baseRun, {
      activityType: 'tool-calling',
      occurredAt: '2026-03-23T00:00:02.000Z',
      agentId: 'agent-writer',
      toolName: 'view',
      toolCallId: 'tool-call-view-1',
      toolArguments: { path: 'src/main.ts', view_range: [1, 50] },
    });

    // Simulate persisting and reloading via normalizeSessionRunRecords
    const roundTripped = normalizeSessionRunRecords(
      JSON.parse(JSON.stringify([run])) as SessionRunRecord[],
    );

    expect(roundTripped).toHaveLength(1);
    const toolCallEvent = roundTripped[0].events.find(
      (event) => event.kind === 'tool-call',
    );
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent!.toolArguments).toEqual({
      path: 'src/main.ts',
      view_range: [1, 50],
    });
  });

  test('handles missing toolArguments gracefully during normalization', () => {
    const baseRun = createSessionRunRecord({
      requestId: 'turn-1',
      project: createProject(),
      workspaceKind: 'project',
      workflow: createWorkflow(),
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
    });

    const run = appendRunActivityEvent(baseRun, {
      activityType: 'tool-calling',
      occurredAt: '2026-03-23T00:00:02.000Z',
      agentId: 'agent-writer',
      toolName: 'rg',
      toolCallId: 'tool-call-rg-1',
      // No toolArguments provided
    });

    const roundTripped = normalizeSessionRunRecords(
      JSON.parse(JSON.stringify([run])) as SessionRunRecord[],
    );

    const toolCallEvent = roundTripped[0].events.find(
      (event) => event.kind === 'tool-call',
    );
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent!.toolArguments).toBeUndefined();
  });

  test('tracks approval checkpoints as a single timeline event that can be resolved later', () => {
    const baseRun = createSessionRunRecord({
      requestId: 'turn-1',
      project: createProject(),
      workspaceKind: 'project',
      workflow: createWorkflow(),
      triggerMessageId: 'msg-user-1',
      startedAt: '2026-03-23T00:00:01.000Z',
    });

    const pendingApproval: PendingApprovalRecord = {
      id: 'approval-1',
      kind: 'tool-call',
      status: 'pending',
      requestedAt: '2026-03-23T00:00:02.000Z',
      agentId: 'agent-writer',
      agentName: 'Writer',
      title: 'Approve tool access',
      permissionKind: 'tool access',
    };

    const pendingRun = upsertRunApprovalEvent(baseRun, pendingApproval);
    const resolvedRun = upsertRunApprovalEvent(pendingRun, {
      ...pendingApproval,
      status: 'approved',
      resolvedAt: '2026-03-23T00:00:03.000Z',
    });

    const approvalEvent = resolvedRun.events.find((event) => event.kind === 'approval');
    expect(approvalEvent).toMatchObject({
      approvalId: 'approval-1',
      approvalKind: 'tool-call',
      approvalTitle: 'Approve tool access',
      permissionKind: 'tool access',
      status: 'completed',
      decision: 'approved',
      updatedAt: '2026-03-23T00:00:03.000Z',
    });
  });
});
