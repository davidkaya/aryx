import { describe, expect, test } from 'bun:test';

import {
  collapseTimelineEvents,
  filterEventsByAgent,
  formatEventLabel,
  formatRunDuration,
  formatRunStatusLabel,
  formatRunTimestamp,
  summarizeActivity,
  truncateContent,
} from '@renderer/lib/runTimelineFormatting';
import type { RunTimelineEventRecord } from '@shared/domain/runTimeline';

function createEvent(overrides?: Partial<RunTimelineEventRecord>): RunTimelineEventRecord {
  return {
    id: 'run-event-1',
    kind: 'thinking',
    occurredAt: '2026-03-23T12:00:00.000Z',
    status: 'completed',
    ...overrides,
  };
}

describe('run timeline formatting', () => {
  test('formats ISO timestamps as local time strings', () => {
    const result = formatRunTimestamp('2026-03-23T14:30:45.000Z');
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test('returns empty string for invalid timestamps', () => {
    expect(formatRunTimestamp('not-a-date')).toBe('');
  });

  test('formats run durations in human-readable form', () => {
    expect(formatRunDuration('2026-03-23T12:00:00.000Z', '2026-03-23T12:00:00.500Z')).toBe('500ms');
    expect(formatRunDuration('2026-03-23T12:00:00.000Z', '2026-03-23T12:00:05.000Z')).toBe('5s');
    expect(formatRunDuration('2026-03-23T12:00:00.000Z', '2026-03-23T12:01:30.000Z')).toBe('1m 30s');
    expect(formatRunDuration('2026-03-23T12:00:00.000Z', '2026-03-23T12:02:00.000Z')).toBe('2m');
  });

  test('returns undefined for missing or invalid durations', () => {
    expect(formatRunDuration('2026-03-23T12:00:00.000Z', undefined)).toBeUndefined();
    expect(formatRunDuration('2026-03-23T12:00:05.000Z', '2026-03-23T12:00:00.000Z')).toBeUndefined();
  });

  test('formats run status labels', () => {
    expect(formatRunStatusLabel('running')).toBe('Running');
    expect(formatRunStatusLabel('completed')).toBe('Completed');
    expect(formatRunStatusLabel('error')).toBe('Failed');
  });

  test('formats event labels with agent and tool context', () => {
    expect(formatEventLabel(createEvent({ kind: 'run-started' }))).toBe('Run started');
    expect(formatEventLabel(createEvent({ kind: 'thinking', agentName: 'Writer' }))).toBe('Writer thinking');
    expect(formatEventLabel(createEvent({ kind: 'thinking' }))).toBe('Thinking');
    expect(formatEventLabel(createEvent({
      kind: 'handoff',
      sourceAgentName: 'Writer',
      targetAgentName: 'Reviewer',
    }))).toBe('Writer → Reviewer');
    expect(formatEventLabel(createEvent({
      kind: 'handoff',
      targetAgentName: 'Reviewer',
    }))).toBe('Handoff to Reviewer');
    expect(formatEventLabel(createEvent({
      kind: 'tool-call',
      agentName: 'Writer',
      toolName: 'file_search',
    }))).toBe('Writer used file_search');
    expect(formatEventLabel(createEvent({
      kind: 'approval',
      status: 'running',
      approvalTitle: 'Approve tool access',
    }))).toBe('Approve tool access');
    expect(formatEventLabel(createEvent({
      kind: 'approval',
      status: 'completed',
      approvalTitle: 'Approve final response',
    }))).toBe('Approve final response approved');
    expect(formatEventLabel(createEvent({ kind: 'message', agentName: 'Reviewer' }))).toBe('Reviewer');
    expect(formatEventLabel(createEvent({ kind: 'run-completed' }))).toBe('Completed');
    expect(formatEventLabel(createEvent({ kind: 'run-failed' }))).toBe('Failed');
  });

  test('truncates long content with an ellipsis', () => {
    expect(truncateContent(undefined)).toBeUndefined();
    expect(truncateContent('Short content')).toBe('Short content');
    expect(truncateContent('A'.repeat(100), 80)).toBe('A'.repeat(80) + '…');
    expect(truncateContent('Line 1\nLine 2')).toBe('Line 1 Line 2');
    expect(truncateContent('**Bold** [Docs](https://example.com)')).toBe('Bold Docs');
  });

  test('collapses consecutive thinking events from the same agent', () => {
    const events: RunTimelineEventRecord[] = [
      createEvent({ id: 'e1', kind: 'run-started' }),
      createEvent({ id: 'e2', kind: 'thinking', agentName: 'Writer' }),
      createEvent({ id: 'e3', kind: 'thinking', agentName: 'Writer' }),
      createEvent({ id: 'e4', kind: 'thinking', agentName: 'Writer' }),
      createEvent({ id: 'e5', kind: 'message', agentName: 'Writer', messageId: 'msg-1' }),
      createEvent({ id: 'e6', kind: 'run-completed' }),
    ];

    const collapsed = collapseTimelineEvents(events);

    expect(collapsed).toEqual([
      { type: 'single', event: events[0] },
      { type: 'thinking-group', events: [events[1], events[2], events[3]], agentName: 'Writer' },
      { type: 'single', event: events[4] },
      { type: 'single', event: events[5] },
    ]);
  });

  test('does not collapse thinking events from different agents', () => {
    const events: RunTimelineEventRecord[] = [
      createEvent({ id: 'e1', kind: 'thinking', agentName: 'Writer' }),
      createEvent({ id: 'e2', kind: 'thinking', agentName: 'Reviewer' }),
    ];

    const collapsed = collapseTimelineEvents(events);

    expect(collapsed).toEqual([
      { type: 'single', event: events[0] },
      { type: 'single', event: events[1] },
    ]);
  });

  test('keeps a single thinking event as a single item', () => {
    const events: RunTimelineEventRecord[] = [
      createEvent({ id: 'e1', kind: 'thinking', agentName: 'Writer' }),
    ];

    const collapsed = collapseTimelineEvents(events);
    expect(collapsed).toEqual([
      { type: 'single', event: events[0] },
    ]);
  });
});

/* ── filterEventsByAgent ──────────────────────────────────── */

describe('filterEventsByAgent', () => {
  const sharedEvents: RunTimelineEventRecord[] = [
    createEvent({ id: 'e-start', kind: 'run-started' }),
    createEvent({ id: 'e-tc-w1', kind: 'tool-call', agentName: 'Writer', toolName: 'edit' }),
    createEvent({ id: 'e-tc-w2', kind: 'tool-call', agentName: 'Writer', toolName: 'grep' }),
    createEvent({ id: 'e-ap-w', kind: 'approval', agentName: 'Writer' }),
    createEvent({ id: 'e-hoff', kind: 'handoff', sourceAgentName: 'Writer', targetAgentName: 'Reviewer' }),
    createEvent({ id: 'e-tc-r1', kind: 'tool-call', agentName: 'Reviewer', toolName: 'view' }),
    createEvent({ id: 'e-tc-r2', kind: 'tool-call', agentName: 'Reviewer', toolName: 'grep' }),
    createEvent({ id: 'e-msg-r', kind: 'message', agentName: 'Reviewer', content: 'Done.' }),
    createEvent({ id: 'e-end', kind: 'run-completed' }),
  ];

  test('returns all events when agentNames is undefined (single-agent)', () => {
    const result = filterEventsByAgent(sharedEvents, undefined);
    expect(result).toHaveLength(sharedEvents.length);
  });

  test('returns all events when agentNames is an empty set', () => {
    const result = filterEventsByAgent(sharedEvents, new Set());
    expect(result).toHaveLength(sharedEvents.length);
  });

  test('filters to Writer agent events only', () => {
    const result = filterEventsByAgent(sharedEvents, new Set(['Writer']));
    const ids = result.map((e) => e.id);
    expect(ids).toEqual(['e-tc-w1', 'e-tc-w2', 'e-ap-w', 'e-hoff']);
  });

  test('filters to Reviewer agent events only', () => {
    const result = filterEventsByAgent(sharedEvents, new Set(['Reviewer']));
    const ids = result.map((e) => e.id);
    expect(ids).toEqual(['e-hoff', 'e-tc-r1', 'e-tc-r2', 'e-msg-r']);
  });

  test('excludes run-level events from agent-scoped results', () => {
    const result = filterEventsByAgent(sharedEvents, new Set(['Writer']));
    const kinds = result.map((e) => e.kind);
    expect(kinds).not.toContain('run-started');
    expect(kinds).not.toContain('run-completed');
  });

  test('excludes events with no agentName in agent-scoped mode', () => {
    const events: RunTimelineEventRecord[] = [
      createEvent({ id: 'e1', kind: 'tool-call', agentName: undefined, toolName: 'unknown' }),
      createEvent({ id: 'e2', kind: 'tool-call', agentName: 'Writer', toolName: 'edit' }),
    ];
    const result = filterEventsByAgent(events, new Set(['Writer']));
    expect(result.map((e) => e.id)).toEqual(['e2']);
  });

  test('includes handoff events for both source and target agents', () => {
    const handoff = sharedEvents.find((e) => e.kind === 'handoff')!;
    const writerResult = filterEventsByAgent([handoff], new Set(['Writer']));
    const reviewerResult = filterEventsByAgent([handoff], new Set(['Reviewer']));
    expect(writerResult).toHaveLength(1);
    expect(reviewerResult).toHaveLength(1);
  });
});

/* ── summarizeActivity ────────────────────────────────────── */

describe('summarizeActivity', () => {
  test('counts thinking steps from messages with content', () => {
    const messages = [
      { content: 'step 1' },
      { content: '' },
      { content: 'step 2' },
    ];
    const summary = summarizeActivity(messages, []);
    expect(summary.thinkingSteps).toBe(2);
    expect(summary.toolCalls).toBe(0);
  });

  test('counts tool calls, handoffs, and approvals from events', () => {
    const events: RunTimelineEventRecord[] = [
      createEvent({ id: 'e1', kind: 'tool-call', agentName: 'A' }),
      createEvent({ id: 'e2', kind: 'tool-call', agentName: 'A' }),
      createEvent({ id: 'e3', kind: 'handoff', sourceAgentName: 'A', targetAgentName: 'B' }),
      createEvent({ id: 'e4', kind: 'approval', agentName: 'A' }),
    ];
    const summary = summarizeActivity([], events);
    expect(summary).toMatchObject({
      thinkingSteps: 0,
      toolCalls: 2,
      handoffs: 1,
      approvals: 1,
      hasError: false,
    });
  });

  test('detects run-failed events', () => {
    const events: RunTimelineEventRecord[] = [
      createEvent({ id: 'e1', kind: 'run-failed' }),
    ];
    const summary = summarizeActivity([], events);
    expect(summary.hasError).toBe(true);
  });

  test('produces correct per-agent summary when combined with filterEventsByAgent', () => {
    const allEvents: RunTimelineEventRecord[] = [
      createEvent({ id: 'e-start', kind: 'run-started' }),
      createEvent({ id: 'e1', kind: 'tool-call', agentName: 'Writer' }),
      createEvent({ id: 'e2', kind: 'tool-call', agentName: 'Writer' }),
      createEvent({ id: 'e3', kind: 'tool-call', agentName: 'Writer' }),
      createEvent({ id: 'e4', kind: 'approval', agentName: 'Writer' }),
      createEvent({ id: 'e5', kind: 'handoff', sourceAgentName: 'Writer', targetAgentName: 'Reviewer' }),
      createEvent({ id: 'e6', kind: 'tool-call', agentName: 'Reviewer' }),
      createEvent({ id: 'e7', kind: 'approval', agentName: 'Reviewer' }),
      createEvent({ id: 'e-end', kind: 'run-completed' }),
    ];

    const writerEvents = filterEventsByAgent(allEvents, new Set(['Writer']));
    const writerSummary = summarizeActivity([{ content: 'think1' }, { content: 'think2' }], writerEvents);
    expect(writerSummary).toMatchObject({
      thinkingSteps: 2,
      toolCalls: 3,
      handoffs: 1,
      approvals: 1,
      hasError: false,
    });

    const reviewerEvents = filterEventsByAgent(allEvents, new Set(['Reviewer']));
    const reviewerSummary = summarizeActivity([{ content: 'think3' }], reviewerEvents);
    expect(reviewerSummary).toMatchObject({
      thinkingSteps: 1,
      toolCalls: 1,
      handoffs: 1,
      approvals: 1,
      hasError: false,
    });
  });
});
