import { describe, expect, test } from 'bun:test';

import {
  applySessionEventActivity,
  buildAgentActivityRows,
  formatAgentActivityLabel,
  isAgentActivityActive,
  isAgentActivityCompleted,
  pruneSessionActivities,
  type SessionActivityMap,
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

  test('clears stale activity when a session restarts or finishes', () => {
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

    expect(
      applySessionEventActivity(current, {
        sessionId: 'session-2',
        kind: 'error',
        occurredAt: '2026-03-23T00:00:00.000Z',
        error: 'Boom',
      }),
    ).toEqual({
      'session-1': current['session-1'],
    });
  });

  test('builds rows for all agents with sensible defaults', () => {
    expect(buildAgentActivityRows(undefined, agents, true)).toEqual([
      {
        key: 'architect',
        agentName: 'Architect',
        activity: {
          agentId: 'architect',
          agentName: 'Architect',
          activityType: 'thinking',
        },
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
        true,
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
    expect(formatAgentActivityLabel(undefined)).toBe('Waiting…');
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
