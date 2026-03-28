import { describe, expect, test } from 'bun:test';

import {
  applySessionEventActivity,
  applyAssistantUsageEvent,
  buildAgentActivityRows,
  formatAgentActivityLabel,
  formatDuration,
  formatNanoAiu,
  formatTokenCount,
  isAgentActivityActive,
  isAgentActivityCompleted,
  pruneSessionActivities,
  pruneSessionRequestUsage,
  type SessionActivityMap,
  type SessionRequestUsageMap,
} from '@renderer/lib/sessionActivity';
import type { PatternDefinition } from '@shared/domain/pattern';
import type { SessionEventRecord } from '@shared/domain/event';

describe('session activity helpers', () => {
  const agents: PatternDefinition['agents'] = [
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
  ];

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
          patternId: 'pattern-1',
          patternName: 'Pattern',
          patternMode: 'single',
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
