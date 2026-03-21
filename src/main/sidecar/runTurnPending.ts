import type { AgentActivityEvent, TurnDeltaEvent } from '@shared/contracts/sidecar';
import type { ChatMessageRecord } from '@shared/domain/session';

export interface RunTurnPendingCommand {
  kind: 'run-turn';
  resolve: (messages: ChatMessageRecord[]) => void;
  reject: (error: Error) => void;
  onDelta: (event: TurnDeltaEvent) => void | Promise<void>;
  onActivity: (event: AgentActivityEvent) => void | Promise<void>;
  errored: boolean;
}

export function markRunTurnPendingErrored(
  pending: RunTurnPendingCommand,
  error: unknown,
): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (!pending.errored) {
    pending.errored = true;
    pending.reject(normalized);
  }

  return normalized;
}

export function shouldHandleRunTurnEvent(pending: RunTurnPendingCommand): boolean {
  return !pending.errored;
}
