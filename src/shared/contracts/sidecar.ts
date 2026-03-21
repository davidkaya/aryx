import type { PatternDefinition, PatternValidationIssue } from '@shared/domain/pattern';
import type { ChatMessageRecord } from '@shared/domain/session';

export interface SidecarModeCapability {
  available: boolean;
  reason?: string;
}

export interface SidecarCapabilities {
  runtime: 'dotnet-maf';
  modes: Record<PatternDefinition['mode'], SidecarModeCapability>;
}

export interface DescribeCapabilitiesCommand {
  type: 'describe-capabilities';
  requestId: string;
}

export interface ValidatePatternCommand {
  type: 'validate-pattern';
  requestId: string;
  pattern: PatternDefinition;
}

export interface RunTurnCommand {
  type: 'run-turn';
  requestId: string;
  sessionId: string;
  projectPath: string;
  pattern: PatternDefinition;
  messages: ChatMessageRecord[];
}

export type SidecarCommand = DescribeCapabilitiesCommand | ValidatePatternCommand | RunTurnCommand;

export interface CapabilitiesEvent {
  type: 'capabilities';
  requestId: string;
  capabilities: SidecarCapabilities;
}

export interface PatternValidationEvent {
  type: 'pattern-validation';
  requestId: string;
  issues: PatternValidationIssue[];
}

export interface TurnDeltaEvent {
  type: 'turn-delta';
  requestId: string;
  sessionId: string;
  messageId: string;
  authorName: string;
  contentDelta: string;
}

export interface TurnCompleteEvent {
  type: 'turn-complete';
  requestId: string;
  sessionId: string;
  messages: ChatMessageRecord[];
}

export interface CommandErrorEvent {
  type: 'command-error';
  requestId: string;
  message: string;
}

export interface CommandCompleteEvent {
  type: 'command-complete';
  requestId: string;
}

export type SidecarEvent =
  | CapabilitiesEvent
  | PatternValidationEvent
  | TurnDeltaEvent
  | TurnCompleteEvent
  | CommandErrorEvent
  | CommandCompleteEvent;
