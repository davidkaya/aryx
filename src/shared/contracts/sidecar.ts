import type { PatternDefinition, PatternValidationIssue, ReasoningEffort } from '@shared/domain/pattern';
import type { ChatMessageRecord } from '@shared/domain/session';

export interface SidecarModeCapability {
  available: boolean;
  reason?: string;
}

export type SidecarConnectionStatus =
  | 'ready'
  | 'copilot-cli-missing'
  | 'copilot-auth-required'
  | 'copilot-error';

export type SidecarCopilotCliVersionStatus = 'latest' | 'outdated' | 'unknown';

export interface SidecarCopilotCliVersionDiagnostics {
  status: SidecarCopilotCliVersionStatus;
  installedVersion?: string;
  latestVersion?: string;
  detail?: string;
}

export interface SidecarCopilotAccountDiagnostics {
  authenticated: boolean;
  login?: string;
  host?: string;
  authType?: string;
  statusMessage?: string;
  organizations?: string[];
}

export interface SidecarConnectionDiagnostics {
  status: SidecarConnectionStatus;
  summary: string;
  detail?: string;
  copilotCliPath?: string;
  copilotCliVersion?: SidecarCopilotCliVersionDiagnostics;
  account?: SidecarCopilotAccountDiagnostics;
  checkedAt: string;
}

export interface SidecarModelCapability {
  id: string;
  name: string;
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}

export interface SidecarCapabilities {
  runtime: 'dotnet-maf';
  modes: Record<PatternDefinition['mode'], SidecarModeCapability>;
  models: SidecarModelCapability[];
  connection: SidecarConnectionDiagnostics;
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
  workspaceKind?: 'project' | 'scratchpad';
  pattern: PatternDefinition;
  messages: ChatMessageRecord[];
  tooling?: RunTurnToolingConfig;
}

export type SidecarCommand = DescribeCapabilitiesCommand | ValidatePatternCommand | RunTurnCommand;

export interface RunTurnLocalMcpServerConfig {
  id: string;
  name: string;
  transport: 'local';
  tools: string[];
  timeoutMs?: number;
  command: string;
  args: string[];
  cwd?: string;
}

export interface RunTurnRemoteMcpServerConfig {
  id: string;
  name: string;
  transport: 'http' | 'sse';
  tools: string[];
  timeoutMs?: number;
  url: string;
}

export type RunTurnMcpServerConfig = RunTurnLocalMcpServerConfig | RunTurnRemoteMcpServerConfig;

export interface RunTurnLspProfileConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  languageId: string;
  fileExtensions: string[];
}

export interface RunTurnToolingConfig {
  mcpServers: RunTurnMcpServerConfig[];
  lspProfiles: RunTurnLspProfileConfig[];
}

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

export type AgentActivityType = 'thinking' | 'tool-calling' | 'handoff' | 'completed';

export interface AgentActivityEvent {
  type: 'agent-activity';
  requestId: string;
  sessionId: string;
  activityType: AgentActivityType;
  agentId?: string;
  agentName?: string;
  toolName?: string;
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
  | AgentActivityEvent
  | CommandErrorEvent
  | CommandCompleteEvent;
