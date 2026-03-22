import { describe, expect, test } from 'bun:test';

import {
  shouldHandleSidecarExit,
  shouldRestartSidecarOnCapabilityRefresh,
} from '@main/sidecar/sidecarRefresh';

describe('shouldRestartSidecarOnCapabilityRefresh', () => {
  test('restarts the sidecar when no run-turn is active', () => {
    expect(shouldRestartSidecarOnCapabilityRefresh(false)).toBe(true);
  });

  test('keeps the existing sidecar when a run-turn is active', () => {
    expect(shouldRestartSidecarOnCapabilityRefresh(true)).toBe(false);
  });
});

describe('shouldHandleSidecarExit', () => {
  test('handles exit events from the currently active sidecar process', () => {
    expect(shouldHandleSidecarExit(1234, 1234)).toBe(true);
  });

  test('ignores exit events from a stale sidecar process', () => {
    expect(shouldHandleSidecarExit(1234, 5678)).toBe(false);
  });

  test('ignores exit events when either process id is missing', () => {
    expect(shouldHandleSidecarExit(undefined, 5678)).toBe(false);
    expect(shouldHandleSidecarExit(1234, undefined)).toBe(false);
  });
});
