import { describe, expect, test } from 'bun:test';

import {
  applySubagentEvent,
  pruneSubagentMap,
  type ActiveSubagentMap,
} from '@renderer/lib/subagentTracker';
import type { SessionEventRecord } from '@shared/domain/event';

function subagentStarted(overrides: Partial<SessionEventRecord> = {}): SessionEventRecord {
  return {
    sessionId: 'session-1',
    kind: 'subagent',
    occurredAt: '2026-03-28T10:00:00.000Z',
    subagentEventKind: 'started',
    customAgentName: 'explore',
    customAgentDisplayName: 'Explore Agent',
    customAgentDescription: 'Explores the codebase',
    subagentToolCallId: 'tc-1',
    subagentModel: 'claude-haiku-4.5',
    ...overrides,
  };
}

function subagentCompleted(overrides: Partial<SessionEventRecord> = {}): SessionEventRecord {
  return {
    sessionId: 'session-1',
    kind: 'subagent',
    occurredAt: '2026-03-28T10:00:05.000Z',
    subagentEventKind: 'completed',
    customAgentName: 'explore',
    customAgentDisplayName: 'Explore Agent',
    subagentToolCallId: 'tc-1',
    ...overrides,
  };
}

function subagentFailed(overrides: Partial<SessionEventRecord> = {}): SessionEventRecord {
  return {
    sessionId: 'session-1',
    kind: 'subagent',
    occurredAt: '2026-03-28T10:00:05.000Z',
    subagentEventKind: 'failed',
    customAgentName: 'explore',
    customAgentDisplayName: 'Explore Agent',
    subagentToolCallId: 'tc-1',
    subagentError: 'Something went wrong',
    ...overrides,
  };
}

function agentActivity(overrides: Partial<SessionEventRecord> = {}): SessionEventRecord {
  return {
    sessionId: 'session-1',
    kind: 'agent-activity',
    occurredAt: '2026-03-28T10:00:01.000Z',
    activityType: 'thinking',
    agentName: 'Explore Agent',
    ...overrides,
  };
}

describe('subagent tracker', () => {
  describe('applySubagentEvent', () => {
    test('adds a running subagent on started event', () => {
      const result = applySubagentEvent({}, subagentStarted());

      const subagents = result['session-1'];
      expect(subagents).toHaveLength(1);
      expect(subagents![0]).toEqual(expect.objectContaining({
        toolCallId: 'tc-1',
        name: 'Explore Agent',
        description: 'Explores the codebase',
        model: 'claude-haiku-4.5',
        status: 'running',
      }));
    });

    test('marks subagent completed', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted());
      state = applySubagentEvent(state, subagentCompleted());

      const subagents = state['session-1'];
      expect(subagents).toHaveLength(1);
      expect(subagents![0]!.status).toBe('completed');
      expect(subagents![0]!.activityLabel).toBe('Completed');
    });

    test('marks subagent failed with error', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted());
      state = applySubagentEvent(state, subagentFailed());

      const subagents = state['session-1'];
      expect(subagents).toHaveLength(1);
      expect(subagents![0]!.status).toBe('failed');
      expect(subagents![0]!.error).toBe('Something went wrong');
    });

    test('tracks multiple subagents concurrently', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted({ subagentToolCallId: 'tc-1', customAgentDisplayName: 'Agent A' }));
      state = applySubagentEvent(state, subagentStarted({ subagentToolCallId: 'tc-2', customAgentDisplayName: 'Agent B' }));

      const subagents = state['session-1'];
      expect(subagents).toHaveLength(2);
      expect(subagents![0]!.name).toBe('Agent A');
      expect(subagents![1]!.name).toBe('Agent B');
    });

    test('completes one subagent while another keeps running', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted({ subagentToolCallId: 'tc-1', customAgentDisplayName: 'Agent A' }));
      state = applySubagentEvent(state, subagentStarted({ subagentToolCallId: 'tc-2', customAgentDisplayName: 'Agent B' }));
      state = applySubagentEvent(state, subagentCompleted({ subagentToolCallId: 'tc-1' }));

      const subagents = state['session-1'];
      expect(subagents).toHaveLength(2);
      expect(subagents![0]!.status).toBe('completed');
      expect(subagents![1]!.status).toBe('running');
    });

    test('clears subagents when session goes idle', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted());
      state = applySubagentEvent(state, {
        sessionId: 'session-1',
        kind: 'status',
        occurredAt: '2026-03-28T10:00:10.000Z',
        status: 'idle',
      });

      expect(state['session-1']).toBeUndefined();
    });

    test('returns same reference when idle event has no subagents', () => {
      const state: ActiveSubagentMap = {};
      const result = applySubagentEvent(state, {
        sessionId: 'session-1',
        kind: 'status',
        occurredAt: '2026-03-28T10:00:10.000Z',
        status: 'idle',
      });

      expect(result).toBe(state);
    });

    test('ignores unrelated event kinds', () => {
      const state: ActiveSubagentMap = {};
      const result = applySubagentEvent(state, {
        sessionId: 'session-1',
        kind: 'message-delta',
        occurredAt: '2026-03-28T10:00:00.000Z',
        contentDelta: 'hello',
      });

      expect(result).toBe(state);
    });

    test('updates activity label from agent-activity event', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted());
      state = applySubagentEvent(state, agentActivity({
        activityType: 'tool-calling',
        toolName: 'grep',
      }));

      expect(state['session-1']![0]!.activityLabel).toBe('Using grep…');
    });

    test('updates activity label to thinking', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted());
      state = applySubagentEvent(state, agentActivity({
        activityType: 'thinking',
      }));

      expect(state['session-1']![0]!.activityLabel).toBe('Thinking…');
    });

    test('ignores agent-activity for non-matching agent name', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted());
      const before = state;
      state = applySubagentEvent(state, agentActivity({
        agentName: 'Completely Different Agent',
        activityType: 'thinking',
      }));

      expect(state).toBe(before);
    });

    test('does not update completed subagent from agent-activity', () => {
      let state: ActiveSubagentMap = {};
      state = applySubagentEvent(state, subagentStarted());
      state = applySubagentEvent(state, subagentCompleted());
      const before = state;
      state = applySubagentEvent(state, agentActivity({
        activityType: 'thinking',
      }));

      expect(state).toBe(before);
    });

    test('uses customAgentName when displayName is absent', () => {
      const result = applySubagentEvent({}, subagentStarted({
        customAgentDisplayName: undefined,
        customAgentName: 'task-agent',
      }));

      expect(result['session-1']![0]!.name).toBe('task-agent');
    });

    test('uses toolCallId as key, falls back to customAgentName', () => {
      const result = applySubagentEvent({}, subagentStarted({
        subagentToolCallId: undefined,
        customAgentName: 'fallback-key',
      }));

      expect(result['session-1']![0]!.toolCallId).toBe('fallback-key');
    });
  });

  describe('pruneSubagentMap', () => {
    test('removes entries for deleted sessions', () => {
      const state: ActiveSubagentMap = {
        'session-1': [{ toolCallId: 'tc-1', name: 'A', activityLabel: 'Working…', startedAt: '', status: 'running' }],
        'session-2': [{ toolCallId: 'tc-2', name: 'B', activityLabel: 'Working…', startedAt: '', status: 'running' }],
      };

      const result = pruneSubagentMap(state, ['session-1']);
      expect(result['session-1']).toBeDefined();
      expect(result['session-2']).toBeUndefined();
    });

    test('returns same reference when nothing is pruned', () => {
      const state: ActiveSubagentMap = {
        'session-1': [],
      };

      const result = pruneSubagentMap(state, ['session-1']);
      expect(result).toBe(state);
    });
  });
});
