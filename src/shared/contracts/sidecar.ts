import type { PatternDefinition, PatternValidationIssue, ReasoningEffort } from '@shared/domain/pattern';
import type { ApprovalCheckpointKind, ApprovalDecision } from '@shared/domain/approval';
import type { ChatMessageRecord } from '@shared/domain/session';
import type { RuntimeToolDefinition } from '@shared/domain/tooling';

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
  runtimeTools: RuntimeToolDefinition[];
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

export type InteractionMode = 'interactive' | 'plan';

export interface RunTurnCommand {
  type: 'run-turn';
  requestId: string;
  sessionId: string;
  projectPath: string;
  workspaceKind?: 'project' | 'scratchpad';
  mode?: InteractionMode;
  pattern: PatternDefinition;
  messages: ChatMessageRecord[];
  tooling?: RunTurnToolingConfig;
}

export interface CancelTurnCommand {
  type: 'cancel-turn';
  requestId: string;
  targetRequestId: string;
}

export interface ResolveApprovalCommand {
  type: 'resolve-approval';
  requestId: string;
  approvalId: string;
  decision: ApprovalDecision;
}

export interface ResolveUserInputCommand {
  type: 'resolve-user-input';
  requestId: string;
  userInputId: string;
  answer: string;
  wasFreeform: boolean;
}

export type SidecarCommand =
  | DescribeCapabilitiesCommand
  | ValidatePatternCommand
  | RunTurnCommand
  | CancelTurnCommand
  | ResolveApprovalCommand
  | ResolveUserInputCommand;

export interface RunTurnLocalMcpServerConfig {
  id: string;
  name: string;
  transport: 'local';
  tools: string[];
  timeoutMs?: number;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunTurnRemoteMcpServerConfig {
  id: string;
  name: string;
  transport: 'http' | 'sse';
  tools: string[];
  timeoutMs?: number;
  url: string;
  headers?: Record<string, string>;
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
  content?: string;
}

export interface TurnCompleteEvent {
  type: 'turn-complete';
  requestId: string;
  sessionId: string;
  messages: ChatMessageRecord[];
  cancelled?: boolean;
}

export type AgentActivityType = 'thinking' | 'tool-calling' | 'handoff' | 'completed';

export interface AgentActivityEvent {
  type: 'agent-activity';
  requestId: string;
  sessionId: string;
  activityType: AgentActivityType;
  agentId?: string;
  agentName?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  toolName?: string;
}

export interface PermissionDetail {
  kind: string;
  intention?: string;
  command?: string;
  warning?: string;
  possiblePaths?: string[];
  possibleUrls?: string[];
  hasWriteFileRedirection?: boolean;
  fileName?: string;
  diff?: string;
  newFileContents?: string;
  path?: string;
  serverName?: string;
  toolTitle?: string;
  args?: Record<string, unknown>;
  readOnly?: boolean;
  url?: string;
  subject?: string;
  fact?: string;
  citations?: string;
  toolDescription?: string;
  hookMessage?: string;
}

export interface ApprovalRequestedEvent {
  type: 'approval-requested';
  requestId: string;
  sessionId: string;
  approvalId: string;
  approvalKind: ApprovalCheckpointKind;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  permissionKind?: string;
  title: string;
  detail?: string;
  permissionDetail?: PermissionDetail;
}

export interface UserInputRequestedEvent {
  type: 'user-input-requested';
  requestId: string;
  sessionId: string;
  userInputId: string;
  agentId?: string;
  agentName?: string;
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}

export interface McpOauthStaticClientConfigEvent {
  clientId: string;
  publicClient?: boolean;
}

export interface McpOauthRequiredEvent {
  type: 'mcp-oauth-required';
  requestId: string;
  sessionId: string;
  oauthRequestId: string;
  agentId?: string;
  agentName?: string;
  serverName: string;
  serverUrl: string;
  staticClientConfig?: McpOauthStaticClientConfigEvent;
}

export interface ExitPlanModeRequestedEvent {
  type: 'exit-plan-mode-requested';
  requestId: string;
  sessionId: string;
  exitPlanId: string;
  agentId?: string;
  agentName?: string;
  summary: string;
  planContent: string;
  actions?: string[];
  recommendedAction?: string;
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
  | ApprovalRequestedEvent
  | UserInputRequestedEvent
  | McpOauthRequiredEvent
  | ExitPlanModeRequestedEvent
  | CommandErrorEvent
  | CommandCompleteEvent;
