import { describe, expect, test } from 'bun:test';

import {
  applySessionEventActivity,
  applyAssistantUsageEvent,
  applyTurnEventLog,
  buildAgentActivityRows,
  formatAgentActivityLabel,
  formatDuration,
  formatNanoAiu,
  formatTokenCount,
  isAgentActivityActive,
  isAgentActivityCompleted,
  pruneSessionActivities,
  pruneSessionRequestUsage,
  purgeCompletedActivity,
  summarizeSessionActivity,
  type SessionActivityMap,
  type SessionRequestUsageMap,
} from '@renderer/lib/sessionActivity';
import type { WorkflowDefinition } from '@shared/domain/workflow';
import type { SessionEventRecord } from '@shared/domain/event';

describe('session activity helpers', () => {
  const agents = [
    {
      id: 'architect',
      name: 'Architect',
      description: 'Designs the system.',
      instructions: 'Think about architecture.',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Reviews the solution.',
      instructions: 'Review the work.',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    },
  ] satisfies Array<{
    id: string;
    name: string;
    description: string;
    instructions: string;
    model: string;
    reasoningEffort?: 'high' | 'medium';
  }>;

  test('stores activity per session and per agent', () => {
    const architectEvent: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'thinking',
      agentId: 'architect',
      agentName: 'Architect',
    };
    const reviewerEvent: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:01.000Z',
      activityType: 'tool-calling',
      agentId: 'reviewer',
      agentName: 'Reviewer',
      toolName: 'read_file',
    };

    expect(applySessionEventActivity({}, architectEvent)).toEqual({
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
      },
    });

    expect(
      applySessionEventActivity(
        applySessionEventActivity({}, architectEvent),
        reviewerEvent,
      ),
    ).toEqual({
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'tool-calling',
          toolName: 'read_file',
        },
      },
    });
  });

  test('includes toolArguments in activity state', () => {
    const event: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'tool-calling',
      agentId: 'architect',
      agentName: 'Architect',
      toolName: 'view',
      toolArguments: { path: 'src/main.ts', view_range: [1, 50] },
    };

    const result = applySessionEventActivity({}, event);
    expect(result).toEqual({
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'tool-calling',
          toolName: 'view',
          toolArguments: { path: 'src/main.ts', view_range: [1, 50] },
        },
      },
    });
  });

  test('warns when an agent-activity event is missing identifiers', () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const current: SessionActivityMap = {
        'session-1': {
          architect: {
            agentId: 'architect',
            agentName: 'Architect',
            activityType: 'thinking',
          },
        },
      };

      expect(
        applySessionEventActivity(current, {
          sessionId: 'session-1',
          kind: 'agent-activity',
          occurredAt: '2026-03-23T00:00:00.000Z',
          activityType: 'thinking',
          agentId: '   ',
          agentName: '   ',
        }),
      ).toBe(current);

      expect(warnings).toHaveLength(1);
      expect(String(warnings[0][0])).toContain('Dropping agent-activity event');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('clears stale activity when a session restarts', () => {
    const current: SessionActivityMap = {
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
      },
      'session-2': {
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'handoff',
        },
      },
    };

    expect(
      applySessionEventActivity(current, {
        sessionId: 'session-1',
        kind: 'status',
        occurredAt: '2026-03-23T00:00:00.000Z',
        status: 'running',
      }),
    ).toEqual({
      'session-2': current['session-2'],
    });
  });

  test('preserves completed activity on idle and error', () => {
    const current: SessionActivityMap = {
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
      },
    };

    expect(
      applySessionEventActivity(current, {
        sessionId: 'session-1',
        kind: 'status',
        occurredAt: '2026-03-23T00:00:00.000Z',
        status: 'idle',
      }),
    ).toEqual(current);

    expect(
      applySessionEventActivity(current, {
        sessionId: 'session-1',
        kind: 'error',
        occurredAt: '2026-03-23T00:00:01.000Z',
        error: 'Boom',
      }),
    ).toEqual(current);
  });

  test('clears only active agent states when a session becomes idle', () => {
    const current: SessionActivityMap = {
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'thinking',
        },
      },
    };

    // Active agents transition to 'completed' on idle (grace period before purge)
    expect(
      applySessionEventActivity(current, {
        sessionId: 'session-1',
        kind: 'status',
        occurredAt: '2026-03-23T00:00:01.000Z',
        status: 'idle',
      }),
    ).toEqual({
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'completed',
        },
      },
    });
  });

  test('clears only active agent states when a run is cancelled', () => {
    const current: SessionActivityMap = {
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'thinking',
        },
      },
    };

    // Active agents transition to 'completed' on cancel (grace period before purge)
    expect(
      applySessionEventActivity(current, {
        sessionId: 'session-1',
        kind: 'run-updated',
        occurredAt: '2026-03-23T00:00:01.000Z',
        run: {
          id: 'run-1',
          requestId: 'turn-1',
          projectId: 'project-1',
          projectPath: 'C:\\workspace\\project',
          workspaceKind: 'project',
          workflowId: 'workflow-1',
          workflowName: 'Pattern',
          workflowMode: 'single',
          triggerMessageId: 'msg-1',
          startedAt: '2026-03-23T00:00:00.000Z',
          completedAt: '2026-03-23T00:00:01.000Z',
          status: 'cancelled',
          agents: [],
          events: [],
        },
      }),
    ).toEqual({
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'completed',
        },
      },
    });
  });

  test('builds rows for all agents with sensible defaults', () => {
    expect(buildAgentActivityRows(undefined, agents)).toEqual([
      {
        key: 'architect',
        agentName: 'Architect',
      },
      {
        key: 'reviewer',
        agentName: 'Reviewer',
      },
    ]);

    expect(
      buildAgentActivityRows(
        {
          architect: {
            agentId: 'architect',
            agentName: 'Architect',
            activityType: 'completed',
          },
          reviewer: {
            agentId: 'reviewer',
            agentName: 'Reviewer',
            activityType: 'tool-calling',
            toolName: 'read_file',
          },
        },
        agents,
      ),
    ).toEqual([
      {
        key: 'architect',
        agentName: 'Architect',
        activity: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
      },
      {
        key: 'reviewer',
        agentName: 'Reviewer',
        activity: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'tool-calling',
          toolName: 'read_file',
        },
      },
    ]);
  });

  test('formats contextual activity labels and state flags', () => {
    expect(formatAgentActivityLabel(undefined)).toBe('No status yet');
    expect(
      formatAgentActivityLabel({
        agentId: 'reviewer',
        agentName: 'Reviewer',
        activityType: 'tool-calling',
        toolName: 'read_file',
      }),
    ).toBe('Using read_file…');
    expect(
      formatAgentActivityLabel({
        agentId: 'reviewer',
        agentName: 'Reviewer',
        activityType: 'handoff',
      }),
    ).toBe('Handling handoff…');
    expect(
      formatAgentActivityLabel({
        agentId: 'reviewer',
        agentName: 'Reviewer',
        activityType: 'completed',
      }),
    ).toBe('Completed');
    expect(
      isAgentActivityActive({
        agentId: 'architect',
        agentName: 'Architect',
        activityType: 'thinking',
      }),
    ).toBe(true);
    expect(
      isAgentActivityCompleted({
        agentId: 'architect',
        agentName: 'Architect',
        activityType: 'completed',
      }),
    ).toBe(true);
    expect(isAgentActivityCompleted(undefined)).toBe(false);
  });

  test('prunes activity state for sessions that no longer exist', () => {
    const current: SessionActivityMap = {
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
      },
      'session-2': {
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'tool-calling',
          toolName: 'read_file',
        },
      },
    };

    expect(pruneSessionActivities(current, ['session-2'])).toEqual({
      'session-2': current['session-2'],
    });
  });

  test('purgeCompletedActivity removes completed entries after grace period', () => {
    const current: SessionActivityMap = {
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'completed',
        },
      },
    };

    const result = purgeCompletedActivity(current, 'session-1');
    expect(result['session-1']).toBeUndefined();
  });

  test('purgeCompletedActivity is a no-op when nothing is completed', () => {
    const current: SessionActivityMap = {
      'session-1': {
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
      },
    };
    expect(purgeCompletedActivity(current, 'session-1')).toBe(current);
  });

  test('summarizeSessionActivity returns the most relevant label', () => {
    expect(summarizeSessionActivity(undefined)).toBeUndefined();
    expect(summarizeSessionActivity({})).toBeUndefined();

    expect(
      summarizeSessionActivity({
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
      }),
    ).toBe('Thinking…');

    expect(
      summarizeSessionActivity({
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'tool-calling',
          toolName: 'bash',
        },
      }),
    ).toBe('Using bash…');

    // Thinking takes priority over tool-calling
    expect(
      summarizeSessionActivity({
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
        reviewer: {
          agentId: 'reviewer',
          agentName: 'Reviewer',
          activityType: 'tool-calling',
          toolName: 'read_file',
        },
      }),
    ).toBe('Thinking…');

    expect(
      summarizeSessionActivity({
        architect: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'completed',
        },
      }),
    ).toBe('Completed');
  });
});

describe('assistant usage accumulator', () => {
  function makeUsageEvent(overrides: Partial<SessionEventRecord> = {}): SessionEventRecord {
    return {
      sessionId: 'session-1',
      kind: 'assistant-usage',
      occurredAt: '2026-03-23T00:00:00.000Z',
      agentId: 'architect',
      agentName: 'Architect',
      usageModel: 'gpt-5.4',
      usageInputTokens: 1200,
      usageOutputTokens: 300,
      usageCost: 0.42,
      usageDuration: 8200,
      usageTotalNanoAiu: 1_200_000_000,
      ...overrides,
    };
  }

  test('accumulates session-level totals from assistant-usage events', () => {
    let state: SessionRequestUsageMap = {};
    state = applyAssistantUsageEvent(state, makeUsageEvent());
    state = applyAssistantUsageEvent(state, makeUsageEvent({
      usageInputTokens: 800,
      usageOutputTokens: 200,
      usageCost: 0.28,
      usageDuration: 5000,
      usageTotalNanoAiu: 2_400_000_000,
    }));

    const usage = state['session-1']!;
    expect(usage.requestCount).toBe(2);
    expect(usage.totalInputTokens).toBe(2000);
    expect(usage.totalOutputTokens).toBe(500);
    expect(usage.totalCost).toBeCloseTo(0.70);
    expect(usage.totalDurationMs).toBe(13200);
    expect(usage.totalNanoAiu).toBe(2_400_000_000);
  });

  test('accumulates per-agent totals keyed by agentId', () => {
    let state: SessionRequestUsageMap = {};
    state = applyAssistantUsageEvent(state, makeUsageEvent({ agentId: 'architect' }));
    state = applyAssistantUsageEvent(state, makeUsageEvent({
      agentId: 'reviewer',
      agentName: 'Reviewer',
      usageInputTokens: 500,
      usageOutputTokens: 100,
      usageCost: 0.10,
      usageDuration: 3000,
    }));
    state = applyAssistantUsageEvent(state, makeUsageEvent({
      agentId: 'architect',
      usageInputTokens: 600,
      usageOutputTokens: 150,
      usageCost: 0.20,
      usageDuration: 4000,
    }));

    const usage = state['session-1']!;
    expect(usage.perAgent['architect']!.requestCount).toBe(2);
    expect(usage.perAgent['architect']!.inputTokens).toBe(1800);
    expect(usage.perAgent['reviewer']!.requestCount).toBe(1);
    expect(usage.perAgent['reviewer']!.inputTokens).toBe(500);
  });

  test('ignores non-assistant-usage events', () => {
    const state: SessionRequestUsageMap = {};
    const result = applyAssistantUsageEvent(state, {
      sessionId: 'session-1',
      kind: 'session-usage',
      occurredAt: '2026-03-23T00:00:00.000Z',
      tokenLimit: 100000,
      currentTokens: 5000,
    });
    expect(result).toBe(state);
  });

  test('stores latest quota snapshots', () => {
    const snapshots = {
      premium_interactions: {
        entitlementRequests: 50,
        usedRequests: 12,
        remainingPercentage: 76,
        overage: 0,
        overageAllowedWithExhaustedQuota: true,
        resetDate: '2026-04-01T00:00:00Z',
      },
    };

    let state: SessionRequestUsageMap = {};
    state = applyAssistantUsageEvent(state, makeUsageEvent({ usageQuotaSnapshots: snapshots }));

    expect(state['session-1']!.latestQuotaSnapshots).toEqual(snapshots);
  });

  test('prunes request usage for removed sessions', () => {
    const current: SessionRequestUsageMap = {
      'session-1': {
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalCost: 0.3,
        totalDurationMs: 5000,
        totalNanoAiu: 1_000_000_000,
        requestCount: 1,
        perAgent: {},
      },
      'session-2': {
        totalInputTokens: 500,
        totalOutputTokens: 100,
        totalCost: 0.1,
        totalDurationMs: 2000,
        totalNanoAiu: 500_000_000,
        requestCount: 1,
        perAgent: {},
      },
    };

    const pruned = pruneSessionRequestUsage(current, ['session-2']);
    expect(pruned).toEqual({ 'session-2': current['session-2'] });
    expect(pruned).not.toBe(current);
  });
});

describe('usage formatting helpers', () => {
  test('formatTokenCount formats values at different scales', () => {
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(1200)).toBe('1.2k');
    expect(formatTokenCount(45300)).toBe('45.3k');
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
  });

  test('formatNanoAiu converts nano-AIU to human-readable', () => {
    expect(formatNanoAiu(420_000_000)).toBe('0.42');
    expect(formatNanoAiu(12_300_000_000)).toBe('12.3');
    expect(formatNanoAiu(150_000_000_000)).toBe('150');
  });

  test('formatDuration formats milliseconds', () => {
    expect(formatDuration(8200)).toBe('8.2s');
    expect(formatDuration(150_000)).toBe('2.5m');
  });
});

describe('workflow diagnostic turn events', () => {
  function makeDiagnosticEvent(overrides: Partial<SessionEventRecord> = {}): SessionEventRecord {
    return {
      sessionId: 'session-1',
      kind: 'workflow-diagnostic',
      occurredAt: '2026-03-23T00:00:00.000Z',
      diagnosticSeverity: 'error',
      diagnosticKind: 'executor-failed',
      diagnosticMessage: 'Tool crashed.',
      ...overrides,
    };
  }

  test('formats executor-failed with full metadata', () => {
    const result = applyTurnEventLog({}, makeDiagnosticEvent({
      executorId: 'Primary',
      exceptionType: 'InvalidOperationException',
    }));
    const entries = result['session-1']!;
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Executor failed');
    expect(entries[0].detail).toBe('Primary · InvalidOperationException · Tool crashed.');
    expect(entries[0].success).toBe(false);
  });

  test('formats workflow-warning with message only', () => {
    const result = applyTurnEventLog({}, makeDiagnosticEvent({
      diagnosticSeverity: 'warning',
      diagnosticKind: 'workflow-warning',
      diagnosticMessage: 'Token budget is nearly exhausted.',
      executorId: undefined,
      exceptionType: undefined,
    }));
    const entries = result['session-1']!;
    expect(entries[0].label).toBe('Workflow warning');
    expect(entries[0].detail).toBe('Token budget is nearly exhausted.');
    expect(entries[0].success).toBeUndefined();
  });

  test('formats subworkflow-error with subworkflow ID', () => {
    const result = applyTurnEventLog({}, makeDiagnosticEvent({
      diagnosticKind: 'subworkflow-error',
      subworkflowId: 'subworkflow-review',
      exceptionType: 'InvalidOperationException',
      diagnosticMessage: 'Reviewer agent failed.',
    }));
    const entries = result['session-1']!;
    expect(entries[0].label).toBe('Subworkflow error');
    expect(entries[0].detail).toBe('subworkflow-review · InvalidOperationException · Reviewer agent failed.');
  });

  test('formats workflow-error without optional fields', () => {
    const result = applyTurnEventLog({}, makeDiagnosticEvent({
      diagnosticKind: 'workflow-error',
      diagnosticMessage: 'Workflow terminated unexpectedly.',
      executorId: undefined,
      subworkflowId: undefined,
      exceptionType: undefined,
    }));
    const entries = result['session-1']!;
    expect(entries[0].label).toBe('Workflow error');
    expect(entries[0].detail).toBe('Workflow terminated unexpectedly.');
    expect(entries[0].success).toBe(false);
  });

  test('falls back to severity when diagnosticKind is missing', () => {
    const result = applyTurnEventLog({}, makeDiagnosticEvent({
      diagnosticKind: undefined,
      diagnosticSeverity: 'warning',
      diagnosticMessage: 'Something odd happened.',
    }));
    const entries = result['session-1']!;
    expect(entries[0].label).toBe('Workflow warning');
  });

  test('formats subworkflow-started lifecycle event', () => {
    const result = applyTurnEventLog({}, {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'subworkflow-started',
      subworkflowNodeId: 'data-pipeline',
      subworkflowName: 'Data Pipeline',
    });
    const entries = result['session-1']!;
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Sub-workflow started: Data Pipeline');
    expect(entries[0].phase).toBe('start');
  });

  test('formats subworkflow-completed lifecycle event', () => {
    const result = applyTurnEventLog({}, {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'subworkflow-completed',
      subworkflowNodeId: 'data-pipeline',
      subworkflowName: 'Data Pipeline',
    });
    const entries = result['session-1']!;
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Sub-workflow completed: Data Pipeline');
    expect(entries[0].phase).toBe('end');
    expect(entries[0].success).toBe(true);
  });
});

/* ── Sub-workflow grouping tests ───────────────────────────── */

import {
  buildGroupedActivityRows,
  type SubWorkflowActivityGroup,
} from '@renderer/lib/sessionActivity';
import {
  resolveWorkflowAgentHierarchy,
  type SubWorkflowGroupDescriptor,
  type WorkflowAgentHierarchy,
} from '@shared/domain/workflow';

describe('sub-workflow activity grouping', () => {
  function makeWorkflow(overrides?: Partial<WorkflowDefinition>): WorkflowDefinition {
    return {
      id: 'wf-1',
      name: 'Test Workflow',
      description: 'A test workflow.',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      settings: { orchestrationMode: 'sequential', checkpointing: { enabled: false }, executionMode: 'off-thread' },
      graph: {
        nodes: [
          { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
          { id: 'agent-a', kind: 'agent', label: 'Agent A', position: { x: 100, y: 0 }, order: 1, config: { kind: 'agent', id: 'agent-a', name: 'Agent A', description: '', instructions: '', model: 'gpt-5.4' } },
          { id: 'end', kind: 'end', label: 'End', position: { x: 200, y: 0 }, config: { kind: 'end' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'agent-a', kind: 'direct' },
          { id: 'e2', source: 'agent-a', target: 'end', kind: 'direct' },
        ],
      },
      ...overrides,
    };
  }

  function makeSubWorkflow(): WorkflowDefinition {
    return makeWorkflow({
      id: 'sub-wf-1',
      name: 'Sub Pipeline',
      graph: {
        nodes: [
          { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
          { id: 'inner-agent', kind: 'agent', label: 'Inner Agent', position: { x: 100, y: 0 }, order: 1, config: { kind: 'agent', id: 'inner-agent', name: 'Inner Agent', description: '', instructions: '', model: 'gpt-5.4' } },
          { id: 'inner-agent-2', kind: 'agent', label: 'Inner Agent 2', position: { x: 200, y: 0 }, order: 2, config: { kind: 'agent', id: 'inner-agent-2', name: 'Inner Agent 2', description: '', instructions: '', model: 'gpt-5.4' } },
          { id: 'end', kind: 'end', label: 'End', position: { x: 300, y: 0 }, config: { kind: 'end' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'inner-agent', kind: 'direct' },
          { id: 'e2', source: 'inner-agent', target: 'inner-agent-2', kind: 'direct' },
          { id: 'e3', source: 'inner-agent-2', target: 'end', kind: 'direct' },
        ],
      },
    });
  }

  test('flat workflow produces no sub-workflow groups', () => {
    const workflow = makeWorkflow();
    const hierarchy = resolveWorkflowAgentHierarchy(workflow);
    const result = buildGroupedActivityRows(undefined, hierarchy);

    expect(result.topLevelAgents).toHaveLength(1);
    expect(result.topLevelAgents[0].agentName).toBe('Agent A');
    expect(result.subWorkflows).toHaveLength(0);
  });

  test('workflow with inline sub-workflow produces grouped agents', () => {
    const subWf = makeSubWorkflow();
    const workflow = makeWorkflow({
      graph: {
        nodes: [
          { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
          { id: 'agent-a', kind: 'agent', label: 'Agent A', position: { x: 100, y: 0 }, order: 1, config: { kind: 'agent', id: 'agent-a', name: 'Agent A', description: '', instructions: '', model: 'gpt-5.4' } },
          { id: 'sub-node', kind: 'sub-workflow', label: 'Sub Pipeline', position: { x: 200, y: 0 }, order: 2, config: { kind: 'sub-workflow', inlineWorkflow: subWf } },
          { id: 'end', kind: 'end', label: 'End', position: { x: 300, y: 0 }, config: { kind: 'end' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'agent-a', kind: 'direct' },
          { id: 'e2', source: 'agent-a', target: 'sub-node', kind: 'direct' },
          { id: 'e3', source: 'sub-node', target: 'end', kind: 'direct' },
        ],
      },
    });

    const hierarchy = resolveWorkflowAgentHierarchy(workflow);
    expect(hierarchy.topLevelAgents).toHaveLength(1);
    expect(hierarchy.subWorkflows).toHaveLength(1);
    expect(hierarchy.subWorkflows[0].workflowName).toBe('Sub Pipeline');
    expect(hierarchy.subWorkflows[0].agents).toHaveLength(2);

    const result = buildGroupedActivityRows(undefined, hierarchy);
    expect(result.topLevelAgents).toHaveLength(1);
    expect(result.subWorkflows).toHaveLength(1);
    expect(result.subWorkflows[0].agents).toHaveLength(2);
    expect(result.subWorkflows[0].status).toBe('idle');
  });

  test('sub-workflow group status reflects agent activity', () => {
    const subWf = makeSubWorkflow();
    const workflow = makeWorkflow({
      graph: {
        nodes: [
          { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
          { id: 'sub-node', kind: 'sub-workflow', label: 'Pipeline', position: { x: 100, y: 0 }, config: { kind: 'sub-workflow', inlineWorkflow: subWf } },
          { id: 'end', kind: 'end', label: 'End', position: { x: 200, y: 0 }, config: { kind: 'end' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'sub-node', kind: 'direct' },
          { id: 'e2', source: 'sub-node', target: 'end', kind: 'direct' },
        ],
      },
    });

    const hierarchy = resolveWorkflowAgentHierarchy(workflow);

    // Running: when lifecycle event says 'subworkflow-started'
    const runningActivity = {
      'sub-node': { agentId: 'sub-node', agentName: 'Pipeline', activityType: 'subworkflow-started' as const },
      'inner-agent': { agentId: 'inner-agent', agentName: 'Inner Agent', activityType: 'thinking' as const },
    };
    const running = buildGroupedActivityRows(runningActivity, hierarchy);
    expect(running.subWorkflows[0].status).toBe('running');

    // Completed: when lifecycle event says 'subworkflow-completed'
    const completedActivity = {
      'sub-node': { agentId: 'sub-node', agentName: 'Pipeline', activityType: 'subworkflow-completed' as const },
      'inner-agent': { agentId: 'inner-agent', agentName: 'Inner Agent', activityType: 'completed' as const },
    };
    const completed = buildGroupedActivityRows(completedActivity, hierarchy);
    expect(completed.subWorkflows[0].status).toBe('completed');
  });

  test('sub-workflow group derives running status from active agents', () => {
    const subWf = makeSubWorkflow();
    const workflow = makeWorkflow({
      graph: {
        nodes: [
          { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
          { id: 'sub-node', kind: 'sub-workflow', label: 'Pipeline', position: { x: 100, y: 0 }, config: { kind: 'sub-workflow', inlineWorkflow: subWf } },
          { id: 'end', kind: 'end', label: 'End', position: { x: 200, y: 0 }, config: { kind: 'end' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'sub-node', kind: 'direct' },
          { id: 'e2', source: 'sub-node', target: 'end', kind: 'direct' },
        ],
      },
    });

    const hierarchy = resolveWorkflowAgentHierarchy(workflow);

    // No lifecycle event, but agent is active — derive running status
    const activity = {
      'inner-agent': { agentId: 'inner-agent', agentName: 'Inner Agent', activityType: 'thinking' as const },
    };
    const result = buildGroupedActivityRows(activity, hierarchy);
    expect(result.subWorkflows[0].status).toBe('running');
  });

  test('referenced sub-workflow resolves via options', () => {
    const subWf = makeSubWorkflow();
    const workflow = makeWorkflow({
      graph: {
        nodes: [
          { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
          { id: 'sub-node', kind: 'sub-workflow', label: 'Ref Pipeline', position: { x: 100, y: 0 }, config: { kind: 'sub-workflow', workflowId: 'sub-wf-1' } },
          { id: 'end', kind: 'end', label: 'End', position: { x: 200, y: 0 }, config: { kind: 'end' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'sub-node', kind: 'direct' },
          { id: 'e2', source: 'sub-node', target: 'end', kind: 'direct' },
        ],
      },
    });

    const hierarchy = resolveWorkflowAgentHierarchy(workflow, {
      resolveWorkflow: (id) => (id === 'sub-wf-1' ? subWf : undefined),
    });
    expect(hierarchy.subWorkflows).toHaveLength(1);
    expect(hierarchy.subWorkflows[0].agents).toHaveLength(2);
    expect(hierarchy.subWorkflows[0].workflowId).toBe('sub-wf-1');
  });

  test('dynamic grouping picks up unresolved sub-workflow agents from activity', () => {
    const workflow = makeWorkflow(); // flat workflow, no sub-workflow nodes
    const hierarchy = resolveWorkflowAgentHierarchy(workflow);

    // Activity events arrive with subworkflowNodeId for agents not in the hierarchy
    const activity = {
      'agent-a': { agentId: 'agent-a', agentName: 'Agent A', activityType: 'thinking' as const },
      'dynamic-agent': {
        agentId: 'dynamic-agent',
        agentName: 'Dynamic Agent',
        activityType: 'tool-calling' as const,
        subworkflowNodeId: 'dynamic-sub',
        subworkflowName: 'Dynamic Sub',
        toolName: 'search',
      },
    };
    const result = buildGroupedActivityRows(activity, hierarchy);
    expect(result.topLevelAgents).toHaveLength(1);
    expect(result.subWorkflows).toHaveLength(1);
    expect(result.subWorkflows[0].nodeId).toBe('dynamic-sub');
    expect(result.subWorkflows[0].name).toBe('Dynamic Sub');
    expect(result.subWorkflows[0].agents).toHaveLength(1);
    expect(result.subWorkflows[0].agents[0].agentName).toBe('Dynamic Agent');
    expect(result.subWorkflows[0].status).toBe('running');
  });
});

describe('sub-workflow activity event handling', () => {
  test('stores subworkflow-started lifecycle event keyed by subworkflowNodeId', () => {
    const event: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'subworkflow-started',
      subworkflowNodeId: 'pipeline-node',
      subworkflowName: 'Data Pipeline',
    };

    const result = applySessionEventActivity({}, event);
    expect(result['session-1']).toBeDefined();
    expect(result['session-1']!['pipeline-node']).toEqual({
      agentId: 'pipeline-node',
      agentName: 'Data Pipeline',
      activityType: 'subworkflow-started',
      subworkflowNodeId: 'pipeline-node',
      subworkflowName: 'Data Pipeline',
    });
  });

  test('stores subworkflow-completed lifecycle event replacing started', () => {
    const startEvent: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'subworkflow-started',
      subworkflowNodeId: 'pipeline-node',
      subworkflowName: 'Data Pipeline',
    };
    const completeEvent: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:01.000Z',
      activityType: 'subworkflow-completed',
      subworkflowNodeId: 'pipeline-node',
      subworkflowName: 'Data Pipeline',
    };

    let state = applySessionEventActivity({}, startEvent);
    state = applySessionEventActivity(state, completeEvent);
    expect(state['session-1']!['pipeline-node']?.activityType).toBe('subworkflow-completed');
  });

  test('propagates subworkflow context on regular agent activity events', () => {
    const event: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'thinking',
      agentId: 'inner-agent',
      agentName: 'Inner Agent',
      subworkflowNodeId: 'pipeline-node',
      subworkflowName: 'Data Pipeline',
    };

    const result = applySessionEventActivity({}, event);
    const agentState = result['session-1']!['inner-agent'];
    expect(agentState).toBeDefined();
    expect(agentState.subworkflowNodeId).toBe('pipeline-node');
    expect(agentState.subworkflowName).toBe('Data Pipeline');
  });

  test('drops lifecycle event without subworkflowNodeId', () => {
    const event: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'subworkflow-started',
      // No subworkflowNodeId
    };

    const result = applySessionEventActivity({}, event);
    expect(result['session-1']).toBeUndefined();
  });
});
