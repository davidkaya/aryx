import type {
  AgentActivityEvent,
  ApprovalRequestedEvent,
  ExitPlanModeRequestedEvent,
  McpOauthRequiredEvent,
  MessageReclassifiedEvent,
  TurnDeltaEvent,
  UserInputRequestedEvent,
  SubagentEvent,
  SkillInvokedEvent,
  HookLifecycleEvent,
  SessionUsageEvent,
  SessionCompactionEvent,
  PendingMessagesModifiedEvent,
  AssistantUsageEvent,
  AssistantIntentEvent,
  ReasoningDeltaEvent,
} from '@shared/contracts/sidecar';
import type { ChatMessageRecord } from '@shared/domain/session';

export type TurnScopedEvent =
  | SubagentEvent
  | SkillInvokedEvent
  | HookLifecycleEvent
  | SessionUsageEvent
  | SessionCompactionEvent
  | PendingMessagesModifiedEvent
  | AssistantUsageEvent
  | AssistantIntentEvent
  | ReasoningDeltaEvent;

export interface RunTurnPendingCommand {
  kind: 'run-turn';
  resolve: (messages: ChatMessageRecord[]) => void;
  reject: (error: Error) => void;
  onDelta: (event: TurnDeltaEvent) => void | Promise<void>;
  onActivity: (event: AgentActivityEvent) => void | Promise<void>;
  onApproval: (event: ApprovalRequestedEvent) => void | Promise<void>;
  onUserInput: (event: UserInputRequestedEvent) => void | Promise<void>;
  onMcpOAuthRequired: (event: McpOauthRequiredEvent) => void | Promise<void>;
  onExitPlanMode: (event: ExitPlanModeRequestedEvent) => void | Promise<void>;
  onMessageReclassified: (event: MessageReclassifiedEvent) => void | Promise<void>;
  onTurnScopedEvent: (event: TurnScopedEvent) => void | Promise<void>;
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
