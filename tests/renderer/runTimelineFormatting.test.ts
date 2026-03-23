import { describe, expect, test } from 'bun:test';

import {
  collapseTimelineEvents,
  formatEventLabel,
  formatRunDuration,
  formatRunStatusLabel,
  formatRunTimestamp,
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
    expect(formatEventLabel(createEvent({ kind: 'message', agentName: 'Reviewer' }))).toBe('Reviewer');
    expect(formatEventLabel(createEvent({ kind: 'run-completed' }))).toBe('Completed');
    expect(formatEventLabel(createEvent({ kind: 'run-failed' }))).toBe('Failed');
  });

  test('truncates long content with an ellipsis', () => {
    expect(truncateContent(undefined)).toBeUndefined();
    expect(truncateContent('Short content')).toBe('Short content');
    expect(truncateContent('A'.repeat(100), 80)).toBe('A'.repeat(80) + '…');
    expect(truncateContent('Line 1\nLine 2')).toBe('Line 1 Line 2');
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
