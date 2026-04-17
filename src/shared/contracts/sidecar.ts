import type { ApprovalCheckpointKind, ApprovalDecision } from '@shared/domain/approval';
import type { ChatMessageRecord } from '@shared/domain/session';
import type { RuntimeToolDefinition } from '@shared/domain/tooling';
import type { ChatMessageAttachment } from '@shared/domain/attachment';
import type { ProjectPromptInvocation } from '@shared/domain/projectCustomization';
import type {
  ReasoningEffort,
  WorkflowDefinition,
  WorkflowOrchestrationMode,
  WorkflowValidationIssue,
} from '@shared/domain/workflow';

export type {
  GroupChatModeSettings,
  GroupChatSelectionStrategy,
  HandoffModeSettings,
  HandoffToolCallFiltering,
  OrchestrationModeSettings,
} from '@shared/domain/workflow';

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
  modes: Record<WorkflowOrchestrationMode | 'magentic', SidecarModeCapability>;
  models: SidecarModelCapability[];
  runtimeTools: RuntimeToolDefinition[];
  connection: SidecarConnectionDiagnostics;
}

export interface DescribeCapabilitiesCommand {
  type: 'describe-capabilities';
  requestId: string;
}

export interface ValidateWorkflowCommand {
  type: 'validate-workflow';
  requestId: string;
  workflow: WorkflowDefinition;
  workflowLibrary?: WorkflowDefinition[];
}

export type InteractionMode = 'interactive' | 'plan';
export type MessageMode = 'enqueue' | 'immediate';

export interface WorkflowCheckpointResume {
  workflowSessionId: string;
  checkpointId: string;
  storePath: string;
}

export interface RunTurnCommand {
  type: 'run-turn';
  requestId: string;
  sessionId: string;
  projectPath: string;
  workspaceKind?: 'project' | 'scratchpad';
  mode?: InteractionMode;
  messageMode?: MessageMode;
  projectInstructions?: string;
  workflow: WorkflowDefinition;
  workflowLibrary?: WorkflowDefinition[];
  messages: ChatMessageRecord[];
  attachments?: ChatMessageAttachment[];
  promptInvocation?: ProjectPromptInvocation;
  tooling?: RunTurnToolingConfig;
  resumeFromCheckpoint?: WorkflowCheckpointResume;
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
  alwaysApprove: boolean;
}

export interface ResolveUserInputCommand {
  type: 'resolve-user-input';
  requestId: string;
  userInputId: string;
  answer: string;
  wasFreeform: boolean;
}

export interface ListSessionsCommand {
  type: 'list-sessions';
  requestId: string;
  filter?: CopilotSessionListFilter;
}

export interface DeleteSessionCommand {
  type: 'delete-session';
  requestId: string;
  sessionId?: string;
  copilotSessionId?: string;
}

export interface DisconnectSessionCommand {
  type: 'disconnect-session';
  requestId: string;
  sessionId: string;
}

export interface CopilotSessionListFilter {
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
}

export type SidecarCommand =
  | DescribeCapabilitiesCommand
  | ValidateWorkflowCommand
  | RunTurnCommand
  | CancelTurnCommand
  | ResolveApprovalCommand
  | ResolveUserInputCommand
  | ListSessionsCommand
  | DeleteSessionCommand
  | DisconnectSessionCommand
  | GetQuotaCommand;

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

export interface RunTurnCustomAgentConfig {
  name: string;
  displayName?: string;
  description?: string;
  tools?: string[];
  prompt: string;
  mcpServers?: RunTurnMcpServerConfig[];
  infer?: boolean;
}

export interface RunTurnInfiniteSessionsConfig {
  enabled?: boolean;
  backgroundCompactionThreshold?: number;
  bufferExhaustionThreshold?: number;
}

export interface PatternAgentCopilotConfig {
  customAgents?: RunTurnCustomAgentConfig[];
  agent?: string;
  skillDirectories?: string[];
  disabledSkills?: string[];
  infiniteSessions?: RunTurnInfiniteSessionsConfig;
}

export interface CapabilitiesEvent {
  type: 'capabilities';
  requestId: string;
  capabilities: SidecarCapabilities;
}

export interface WorkflowValidationEvent {
  type: 'workflow-validation';
  requestId: string;
  issues: WorkflowValidationIssue[];
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

export interface MessageReclassifiedEvent {
  type: 'message-reclassified';
  requestId: string;
  sessionId: string;
  messageId: string;
  newKind: 'thinking';
}

export type AgentActivityType =
  | 'thinking'
  | 'tool-calling'
  | 'handoff'
  | 'completed'
  | 'subworkflow-started'
  | 'subworkflow-completed';

export interface ToolCallFileChangePreview {
  path: string;
  diff?: string;
  newFileContents?: string;
}

export interface AgentActivityEvent {
  type: 'agent-activity';
  requestId: string;
  sessionId: string;
  activityType: AgentActivityType;
  agentId?: string;
  agentName?: string;
  subworkflowNodeId?: string;
  subworkflowName?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: Record<string, unknown>;
  fileChanges?: ToolCallFileChangePreview[];
}

export type SubagentEventKind = 'started' | 'completed' | 'failed' | 'selected' | 'deselected';

export interface SubagentEvent {
  type: 'subagent-event';
  requestId: string;
  sessionId: string;
  eventKind: SubagentEventKind;
  agentId?: string;
  agentName?: string;
  toolCallId?: string;
  customAgentName?: string;
  customAgentDisplayName?: string;
  customAgentDescription?: string;
  error?: string;
  model?: string;
  totalToolCalls?: number;
  totalTokens?: number;
  durationMs?: number;
  tools?: string[];
}

export interface SkillInvokedEvent {
  type: 'skill-invoked';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  skillName: string;
  path: string;
  content: string;
  allowedTools?: string[];
  pluginName?: string;
  pluginVersion?: string;
  description?: string;
}

export interface AssistantIntentEvent {
  type: 'assistant-intent';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  intent: string;
}

export interface ReasoningDeltaEvent {
  type: 'reasoning-delta';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  reasoningId: string;
  contentDelta: string;
}

export interface HookLifecycleEvent {
  type: 'hook-lifecycle';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  hookInvocationId: string;
  hookType: string;
  phase: 'start' | 'end';
  success?: boolean;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface SessionUsageEvent {
  type: 'session-usage';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  tokenLimit: number;
  currentTokens: number;
  messagesLength: number;
  systemTokens?: number;
  conversationTokens?: number;
  toolDefinitionsTokens?: number;
  isInitial?: boolean;
}

export interface SessionCompactionEvent {
  type: 'session-compaction';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  phase: 'start' | 'complete';
  success?: boolean;
  error?: string;
  systemTokens?: number;
  conversationTokens?: number;
  toolDefinitionsTokens?: number;
  preCompactionTokens?: number;
  postCompactionTokens?: number;
  preCompactionMessagesLength?: number;
  messagesRemoved?: number;
  tokensRemoved?: number;
  summaryContent?: string;
  checkpointNumber?: number;
  checkpointPath?: string;
}

export interface PendingMessagesModifiedEvent {
  type: 'pending-messages-modified';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
}

export interface WorkflowCheckpointSavedEvent {
  type: 'workflow-checkpoint-saved';
  requestId: string;
  sessionId: string;
  workflowSessionId: string;
  checkpointId: string;
  storePath: string;
  stepNumber: number;
}

export type WorkflowDiagnosticSeverity = 'warning' | 'error';
export type WorkflowDiagnosticKind =
  | 'workflow-warning'
  | 'workflow-error'
  | 'executor-failed'
  | 'subworkflow-warning'
  | 'subworkflow-error';

export interface WorkflowDiagnosticEvent {
  type: 'workflow-diagnostic';
  requestId: string;
  sessionId: string;
  severity: WorkflowDiagnosticSeverity;
  diagnosticKind: WorkflowDiagnosticKind;
  message: string;
  agentId?: string;
  agentName?: string;
  executorId?: string;
  subworkflowId?: string;
  exceptionType?: string;
}

export interface CopilotSessionInfo {
  copilotSessionId: string;
  managedByAryx: boolean;
  sessionId?: string;
  agentId?: string;
  startTime: string;
  modifiedTime: string;
  summary?: string;
  isRemote: boolean;
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
}

export interface SessionsListedEvent {
  type: 'sessions-listed';
  requestId: string;
  sessions: CopilotSessionInfo[];
}

export interface SessionsDeletedEvent {
  type: 'sessions-deleted';
  requestId: string;
  sessionId?: string;
  sessions: CopilotSessionInfo[];
}

export interface SessionDisconnectedEvent {
  type: 'session-disconnected';
  requestId: string;
  sessionId: string;
  cancelledRequestIds: string[];
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
  approvalToolKey?: string;
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

export interface AssistantUsageEvent {
  type: 'assistant-usage';
  requestId: string;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  duration?: number;
  totalNanoAiu?: number;
  quotaSnapshots?: Record<string, QuotaSnapshot>;
}

export interface QuotaSnapshot {
  entitlementRequests: number;
  usedRequests: number;
  remainingPercentage: number;
  overage: number;
  overageAllowedWithExhaustedQuota: boolean;
  resetDate?: string;
}

export interface GetQuotaCommand {
  type: 'get-quota';
  requestId: string;
}

export interface QuotaResultEvent {
  type: 'quota-result';
  requestId: string;
  quotaSnapshots: Record<string, QuotaSnapshot>;
}

export interface CommandCompleteEvent {
  type: 'command-complete';
  requestId: string;
}

export type SidecarEvent =
  | CapabilitiesEvent
  | WorkflowValidationEvent
  | TurnDeltaEvent
  | TurnCompleteEvent
  | MessageReclassifiedEvent
  | AgentActivityEvent
  | SubagentEvent
  | SkillInvokedEvent
  | AssistantIntentEvent
  | ReasoningDeltaEvent
  | HookLifecycleEvent
  | SessionUsageEvent
  | SessionCompactionEvent
  | PendingMessagesModifiedEvent
  | WorkflowCheckpointSavedEvent
  | WorkflowDiagnosticEvent
  | ApprovalRequestedEvent
  | UserInputRequestedEvent
  | McpOauthRequiredEvent
  | ExitPlanModeRequestedEvent
  | SessionsListedEvent
  | SessionsDeletedEvent
  | SessionDisconnectedEvent
  | AssistantUsageEvent
  | QuotaResultEvent
  | CommandErrorEvent
  | CommandCompleteEvent;
