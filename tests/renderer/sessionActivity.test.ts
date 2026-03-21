import { describe, expect, test } from 'bun:test';

import {
  applySessionEventActivity,
  formatSessionActivityLabel,
  pruneSessionActivities,
  shouldAnimateSessionActivity,
  type SessionActivityMap,
} from '@renderer/lib/sessionActivity';
import type { SessionEventRecord } from '@shared/domain/event';

describe('session activity helpers', () => {
  test('stores the latest agent activity by session', () => {
    const event: SessionEventRecord = {
      sessionId: 'session-1',
      kind: 'agent-activity',
      occurredAt: '2026-03-23T00:00:00.000Z',
      activityType: 'tool-calling',
      agentName: 'Code Reviewer',
      toolName: 'read_file',
    };

    expect(applySessionEventActivity({}, event)).toEqual({
      'session-1': {
        sessionId: 'session-1',
        activityType: 'tool-calling',
        agentName: 'Code Reviewer',
        toolName: 'read_file',
      },
    });
  });

  test('clears stale activity when a session restarts or finishes', () => {
    const current: SessionActivityMap = {
      'session-1': {
        sessionId: 'session-1',
        activityType: 'thinking',
        agentName: 'Primary',
      },
      'session-2': {
        sessionId: 'session-2',
        activityType: 'handoff',
        agentName: 'Reviewer',
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

  test('formats contextual activity labels and animation state', () => {
    expect(formatSessionActivityLabel(undefined, 'Primary')).toBe('Primary is thinking…');
    expect(
      formatSessionActivityLabel(
        {
          sessionId: 'session-1',
          activityType: 'tool-calling',
          agentName: 'Reviewer',
          toolName: 'read_file',
        },
        'Primary',
      ),
    ).toBe('Reviewer is using read_file…');
    expect(
      formatSessionActivityLabel(
        {
          sessionId: 'session-1',
          activityType: 'handoff',
          agentName: 'Summarizer',
        },
        'Primary',
      ),
    ).toBe('Handing off to Summarizer…');
    expect(
      formatSessionActivityLabel(
        {
          sessionId: 'session-1',
          activityType: 'completed',
          agentName: 'Reviewer',
        },
        'Primary',
      ),
    ).toBe('Reviewer completed their turn.');
    expect(
      shouldAnimateSessionActivity({
        sessionId: 'session-1',
        activityType: 'thinking',
      }),
    ).toBe(true);
    expect(
      shouldAnimateSessionActivity({
        sessionId: 'session-1',
        activityType: 'completed',
      }),
    ).toBe(false);
  });

  test('prunes activity state for sessions that no longer exist', () => {
    const current: SessionActivityMap = {
      'session-1': {
        sessionId: 'session-1',
        activityType: 'thinking',
      },
      'session-2': {
        sessionId: 'session-2',
        activityType: 'tool-calling',
        toolName: 'read_file',
      },
    };

    expect(pruneSessionActivities(current, ['session-2'])).toEqual({
      'session-2': current['session-2'],
    });
  });
});
