import { describe, expect, test } from 'bun:test';

import {
  buildActivityStream,
  groupActivityStream,
  extractLatestIntent,
  generateActivitySummary,
  type ActivityStreamItem,
} from '@renderer/lib/activityGrouping';
import type { RunTimelineEventRecord } from '@shared/domain/runTimeline';
import type { ChatMessageRecord } from '@shared/domain/session';

function createEvent(overrides?: Partial<RunTimelineEventRecord>): RunTimelineEventRecord {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'tool-call',
    occurredAt: '2026-04-01T12:00:00.000Z',
    status: 'completed',
    ...overrides,
  };
}

function createThinkingMessage(content: string, overrides?: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content,
    createdAt: '2026-04-01T12:00:00.000Z',
    messageKind: 'thinking',
    ...overrides,
  } as ChatMessageRecord;
}

/* ── buildActivityStream ───────────────────────────────────── */

describe('buildActivityStream', () => {
  test('merges thinking messages and events into chronological order', () => {
    const msgs = [createThinkingMessage('think1', { createdAt: '2026-04-01T12:00:02.000Z' })];
    const events = [
      createEvent({ id: 'e1', occurredAt: '2026-04-01T12:00:01.000Z' }),
      createEvent({ id: 'e2', occurredAt: '2026-04-01T12:00:03.000Z' }),
    ];
    const stream = buildActivityStream(msgs, events);
    expect(stream).toHaveLength(3);
    expect(stream[0].kind).toBe('timeline-event');
    expect(stream[1].kind).toBe('thinking-step');
    expect(stream[2].kind).toBe('timeline-event');
  });

  test('skips run-started and thinking event kinds', () => {
    const events = [
      createEvent({ id: 'e1', kind: 'run-started' }),
      createEvent({ id: 'e2', kind: 'thinking' }),
      createEvent({ id: 'e3', kind: 'tool-call', toolName: 'view' }),
    ];
    const stream = buildActivityStream([], events);
    expect(stream).toHaveLength(1);
    expect((stream[0] as { kind: 'timeline-event'; event: RunTimelineEventRecord }).event.id).toBe('e3');
  });
});

/* ── groupActivityStream ───────────────────────────────────── */

describe('groupActivityStream', () => {
  test('groups consecutive same-tool calls', () => {
    const items: ActivityStreamItem[] = [
      { kind: 'timeline-event', event: createEvent({ id: 'e1', toolName: 'view' }) },
      { kind: 'timeline-event', event: createEvent({ id: 'e2', toolName: 'view' }) },
      { kind: 'timeline-event', event: createEvent({ id: 'e3', toolName: 'view' }) },
    ];
    const grouped = groupActivityStream(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe('tool-group');
    if (grouped[0].kind === 'tool-group') {
      expect(grouped[0].toolName).toBe('view');
      expect(grouped[0].events).toHaveLength(3);
    }
  });

  test('does not group non-consecutive same-tool calls', () => {
    const items: ActivityStreamItem[] = [
      { kind: 'timeline-event', event: createEvent({ id: 'e1', toolName: 'view' }) },
      { kind: 'timeline-event', event: createEvent({ id: 'e2', toolName: 'grep' }) },
      { kind: 'timeline-event', event: createEvent({ id: 'e3', toolName: 'view' }) },
    ];
    const grouped = groupActivityStream(items);
    expect(grouped).toHaveLength(3);
    expect(grouped[0].kind).toBe('single-event');
    expect(grouped[1].kind).toBe('single-event');
    expect(grouped[2].kind).toBe('single-event');
  });

  test('converts report_intent to intent-divider', () => {
    const items: ActivityStreamItem[] = [
      {
        kind: 'timeline-event',
        event: createEvent({
          id: 'e1',
          toolName: 'report_intent',
          toolArguments: { intent: 'Exploring codebase' },
        }),
      },
    ];
    const grouped = groupActivityStream(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe('intent-divider');
    if (grouped[0].kind === 'intent-divider') {
      expect(grouped[0].intentText).toBe('Exploring codebase');
    }
  });

  test('skips report_intent with empty intent text', () => {
    const items: ActivityStreamItem[] = [
      {
        kind: 'timeline-event',
        event: createEvent({
          id: 'e1',
          toolName: 'report_intent',
          toolArguments: { intent: '' },
        }),
      },
    ];
    const grouped = groupActivityStream(items);
    expect(grouped).toHaveLength(0);
  });

  test('groups consecutive thinking steps', () => {
    const items: ActivityStreamItem[] = [
      { kind: 'thinking-step', message: createThinkingMessage('thought 1') },
      { kind: 'thinking-step', message: createThinkingMessage('thought 2') },
      { kind: 'thinking-step', message: createThinkingMessage('thought 3') },
    ];
    const grouped = groupActivityStream(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe('thinking-group');
    if (grouped[0].kind === 'thinking-group') {
      expect(grouped[0].messages).toHaveLength(3);
    }
  });

  test('keeps single thinking step as single-thinking', () => {
    const items: ActivityStreamItem[] = [
      { kind: 'thinking-step', message: createThinkingMessage('solo thought') },
    ];
    const grouped = groupActivityStream(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe('single-thinking');
  });

  test('produces a mixed timeline with all item kinds', () => {
    const items: ActivityStreamItem[] = [
      {
        kind: 'timeline-event',
        event: createEvent({ id: 'intent', toolName: 'report_intent', toolArguments: { intent: 'Phase 1' } }),
      },
      { kind: 'timeline-event', event: createEvent({ id: 'v1', toolName: 'view' }) },
      { kind: 'timeline-event', event: createEvent({ id: 'v2', toolName: 'view' }) },
      { kind: 'thinking-step', message: createThinkingMessage('thinking...') },
      { kind: 'timeline-event', event: createEvent({ id: 'g1', toolName: 'grep' }) },
      {
        kind: 'timeline-event',
        event: createEvent({ id: 'intent2', toolName: 'report_intent', toolArguments: { intent: 'Phase 2' } }),
      },
      { kind: 'timeline-event', event: createEvent({ id: 'e1', toolName: 'edit' }) },
    ];
    const grouped = groupActivityStream(items);
    expect(grouped.map((g) => g.kind)).toEqual([
      'intent-divider',
      'tool-group',
      'single-thinking',
      'single-event',
      'intent-divider',
      'single-event',
    ]);
  });
});

/* ── extractLatestIntent ───────────────────────────────────── */

describe('extractLatestIntent', () => {
  test('returns the intent from the last report_intent event', () => {
    const events = [
      createEvent({ id: 'e1', toolName: 'report_intent', toolArguments: { intent: 'Phase 1' } }),
      createEvent({ id: 'e2', toolName: 'view' }),
      createEvent({ id: 'e3', toolName: 'report_intent', toolArguments: { intent: 'Phase 2' } }),
    ];
    expect(extractLatestIntent(events)).toBe('Phase 2');
  });

  test('returns undefined when no report_intent events exist', () => {
    const events = [
      createEvent({ id: 'e1', toolName: 'view' }),
      createEvent({ id: 'e2', toolName: 'grep' }),
    ];
    expect(extractLatestIntent(events)).toBeUndefined();
  });

  test('skips empty intent values', () => {
    const events = [
      createEvent({ id: 'e1', toolName: 'report_intent', toolArguments: { intent: 'Valid' } }),
      createEvent({ id: 'e2', toolName: 'report_intent', toolArguments: { intent: '  ' } }),
    ];
    expect(extractLatestIntent(events)).toBe('Valid');
  });
});

/* ── generateActivitySummary ───────────────────────────────── */

describe('generateActivitySummary', () => {
  test('generates summary from tool mix', () => {
    const events = [
      createEvent({ toolName: 'grep' }),
      createEvent({ toolName: 'grep' }),
      createEvent({ toolName: 'view' }),
      createEvent({ toolName: 'view' }),
      createEvent({ toolName: 'view' }),
      createEvent({ toolName: 'edit' }),
    ];
    const result = generateActivitySummary(events);
    expect(result).toBe('Searched 2 patterns, viewed 3 files, edited 1 file');
  });

  test('excludes report_intent from counts', () => {
    const events = [
      createEvent({ toolName: 'report_intent' }),
      createEvent({ toolName: 'view' }),
    ];
    const result = generateActivitySummary(events);
    expect(result).toBe('Viewed 1 file');
  });

  test('returns undefined for empty events', () => {
    expect(generateActivitySummary([])).toBeUndefined();
  });

  test('falls back to total count for unknown tools', () => {
    const events = [
      createEvent({ toolName: 'custom_tool' }),
      createEvent({ toolName: 'custom_tool' }),
    ];
    const result = generateActivitySummary(events);
    expect(result).toBe('2 actions');
  });
});
