import { describe, expect, test } from 'bun:test';

import { formatElapsedMs } from '@renderer/hooks/useElapsedTimer';

describe('formatElapsedMs', () => {
  test('formats sub-second durations as 0s', () => {
    expect(formatElapsedMs(0)).toBe('0s');
    expect(formatElapsedMs(500)).toBe('0s');
    expect(formatElapsedMs(999)).toBe('0s');
  });

  test('formats seconds under a minute', () => {
    expect(formatElapsedMs(1000)).toBe('1s');
    expect(formatElapsedMs(5_000)).toBe('5s');
    expect(formatElapsedMs(59_000)).toBe('59s');
  });

  test('formats minutes with remaining seconds', () => {
    expect(formatElapsedMs(60_000)).toBe('1m');
    expect(formatElapsedMs(90_000)).toBe('1m 30s');
    expect(formatElapsedMs(125_000)).toBe('2m 5s');
  });

  test('formats exact minutes without trailing seconds', () => {
    expect(formatElapsedMs(120_000)).toBe('2m');
    expect(formatElapsedMs(300_000)).toBe('5m');
  });

  test('clamps negative durations to 0s', () => {
    expect(formatElapsedMs(-5000)).toBe('0s');
  });

  test('formats large durations correctly', () => {
    // 2 hours, 30 minutes, 15 seconds = 9015s = 150m 15s
    expect(formatElapsedMs(9_015_000)).toBe('150m 15s');
  });
});
