import { describe, expect, test } from 'bun:test';

import {
  markRunTurnPendingErrored,
  shouldHandleRunTurnEvent,
  type RunTurnPendingCommand,
} from '@main/sidecar/runTurnPending';

describe('run turn pending helpers', () => {
  test('marks a run-turn pending command as errored and rejects it once', () => {
    const rejected: Error[] = [];
    const pending: RunTurnPendingCommand = {
      kind: 'run-turn',
      resolve: () => undefined,
      reject: (error) => rejected.push(error),
      onDelta: () => undefined,
      onActivity: () => undefined,
      onApproval: () => undefined,
      onUserInput: () => undefined,
      onExitPlanMode: () => undefined,
      onMcpOAuthRequired: () => undefined,
      onTurnScopedEvent: () => undefined,
      errored: false,
    };

    const first = markRunTurnPendingErrored(pending, 'boom');
    const second = markRunTurnPendingErrored(pending, new Error('later'));

    expect(first).toBeInstanceOf(Error);
    expect(first.message).toBe('boom');
    expect(second.message).toBe('later');
    expect(pending.errored).toBe(true);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].message).toBe('boom');
  });

  test('stops handling turn events after the pending command has errored', () => {
    const pending: RunTurnPendingCommand = {
      kind: 'run-turn',
      resolve: () => undefined,
      reject: () => undefined,
      onDelta: () => undefined,
      onActivity: () => undefined,
      onApproval: () => undefined,
      onUserInput: () => undefined,
      onExitPlanMode: () => undefined,
      onMcpOAuthRequired: () => undefined,
      onTurnScopedEvent: () => undefined,
      errored: false,
    };

    expect(shouldHandleRunTurnEvent(pending)).toBe(true);

    markRunTurnPendingErrored(pending, new Error('boom'));

    expect(shouldHandleRunTurnEvent(pending)).toBe(false);
  });
});
