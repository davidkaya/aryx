import { describe, expect, test } from 'bun:test';

import { shouldRestartSidecarOnCapabilityRefresh } from '@main/sidecar/sidecarRefresh';

describe('shouldRestartSidecarOnCapabilityRefresh', () => {
  test('restarts the sidecar when no run-turn is active', () => {
    expect(shouldRestartSidecarOnCapabilityRefresh(false)).toBe(true);
  });

  test('keeps the existing sidecar when a run-turn is active', () => {
    expect(shouldRestartSidecarOnCapabilityRefresh(true)).toBe(false);
  });
});
