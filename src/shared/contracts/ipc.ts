import type { ApprovalDecision } from '@shared/domain/approval';
import type { SidecarCapabilities, InteractionMode, MessageMode, QuotaSnapshot } from '@shared/contracts/sidecar';
import type { PatternDefinition, ReasoningEffort } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { QuerySessionsInput, SessionQueryResult } from '@shared/domain/sessionLibrary';
import type { SessionEventRecord } from '@shared/domain/event';
import type { TerminalExitInfo, TerminalSnapshot } from '@shared/domain/terminal';
import type {
  LspProfileDefinition,
  McpServerDefinition,
  SessionToolingSelection,
  AppearanceTheme,
} from '@shared/domain/tooling';
import type { WorkspaceState } from '@shared/domain/workspace';
import type { ChatMessageAttachment } from '@shared/domain/attachment';

export interface CreateSessionInput {
  projectId: string;
  patternId: string;
}

export interface SavePatternInput {
  pattern: PatternDefinition;
}

export interface SendSessionMessageInput {
  sessionId: string;
  content: string;
  attachments?: ChatMessageAttachment[];
  messageMode?: MessageMode;
}

export interface CancelSessionTurnInput {
  sessionId: string;
}

export interface ResolveSessionApprovalInput {
  sessionId: string;
  approvalId: string;
  decision: ApprovalDecision;
  alwaysApprove?: boolean;
}

export interface ResolveSessionUserInputInput {
  sessionId: string;
  userInputId: string;
  answer: string;
  wasFreeform: boolean;
}

export interface UpdateSessionModelConfigInput {
  sessionId: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface DuplicateSessionInput {
  sessionId: string;
}

export interface BranchSessionInput {
  sessionId: string;
  messageId: string;
}

export interface SetSessionMessagePinnedInput {
  sessionId: string;
  messageId: string;
  isPinned: boolean;
}

export interface RegenerateSessionMessageInput {
  sessionId: string;
  messageId: string;
}

export interface EditAndResendSessionMessageInput {
  sessionId: string;
  messageId: string;
  content: string;
  attachments?: ChatMessageAttachment[];
}

export interface RenameSessionInput {
  sessionId: string;
  title: string;
}

export interface SetSessionPinnedInput {
  sessionId: string;
  isPinned: boolean;
}

export interface SetSessionArchivedInput {
  sessionId: string;
  isArchived: boolean;
}

export interface SetPatternFavoriteInput {
  patternId: string;
  isFavorite: boolean;
}

export interface SaveMcpServerInput {
  server: McpServerDefinition;
}

export interface SaveLspProfileInput {
  profile: LspProfileDefinition;
}

export type DiscoveredToolingResolution = 'accept' | 'dismiss';

export interface RescanProjectConfigsInput {
  projectId: string;
}

export interface RescanProjectCustomizationInput {
  projectId: string;
}

export interface ResolveProjectDiscoveredToolingInput {
  projectId: string;
  serverIds: string[];
  resolution: DiscoveredToolingResolution;
}

export interface SetProjectAgentProfileEnabledInput {
  projectId: string;
  agentProfileId: string;
  enabled: boolean;
}

export interface ResolveWorkspaceDiscoveredToolingInput {
  serverIds: string[];
  resolution: DiscoveredToolingResolution;
}

export interface UpdateSessionToolingInput extends SessionToolingSelection {
  sessionId: string;
}

export interface UpdateSessionApprovalSettingsInput {
  sessionId: string;
  autoApprovedToolNames?: string[];
}

export interface SetSessionInteractionModeInput {
  sessionId: string;
  mode: InteractionMode;
}

export interface DismissSessionPlanReviewInput {
  sessionId: string;
}

export interface DismissSessionMcpAuthInput {
  sessionId: string;
}

export interface StartSessionMcpAuthInput {
  sessionId: string;
}

export interface DeleteSessionInput {
  sessionId: string;
}

export interface ResizeTerminalInput {
  cols: number;
  rows: number;
}

export interface SetTerminalHeightInput {
  height?: number;
}

export type UpdateStatusState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateDownloadProgress {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface UpdateStatus {
  state: UpdateStatusState;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: UpdateDownloadProgress;
  error?: string;
}

export interface ElectronApi {
  describeSidecarCapabilities(): Promise<SidecarCapabilities>;
  refreshSidecarCapabilities(): Promise<SidecarCapabilities>;
  loadWorkspace(): Promise<WorkspaceState>;
  addProject(): Promise<WorkspaceState>;
  removeProject(projectId: string): Promise<WorkspaceState>;
  resolveWorkspaceDiscoveredTooling(input: ResolveWorkspaceDiscoveredToolingInput): Promise<WorkspaceState>;
  refreshProjectGitContext(projectId?: string): Promise<WorkspaceState>;
  rescanProjectConfigs(input: RescanProjectConfigsInput): Promise<WorkspaceState>;
  rescanProjectCustomization(input: RescanProjectCustomizationInput): Promise<WorkspaceState>;
  resolveProjectDiscoveredTooling(input: ResolveProjectDiscoveredToolingInput): Promise<WorkspaceState>;
  setProjectAgentProfileEnabled(input: SetProjectAgentProfileEnabledInput): Promise<WorkspaceState>;
  savePattern(input: SavePatternInput): Promise<WorkspaceState>;
  deletePattern(patternId: string): Promise<WorkspaceState>;
  saveMcpServer(input: SaveMcpServerInput): Promise<WorkspaceState>;
  deleteMcpServer(serverId: string): Promise<WorkspaceState>;
  saveLspProfile(input: SaveLspProfileInput): Promise<WorkspaceState>;
  deleteLspProfile(profileId: string): Promise<WorkspaceState>;
  updateSessionTooling(input: UpdateSessionToolingInput): Promise<WorkspaceState>;
  updateSessionApprovalSettings(input: UpdateSessionApprovalSettingsInput): Promise<WorkspaceState>;
  createSession(input: CreateSessionInput): Promise<WorkspaceState>;
  duplicateSession(input: DuplicateSessionInput): Promise<WorkspaceState>;
  branchSession(input: BranchSessionInput): Promise<WorkspaceState>;
  setSessionMessagePinned(input: SetSessionMessagePinnedInput): Promise<WorkspaceState>;
  renameSession(input: RenameSessionInput): Promise<WorkspaceState>;
  setSessionPinned(input: SetSessionPinnedInput): Promise<WorkspaceState>;
  setSessionArchived(input: SetSessionArchivedInput): Promise<WorkspaceState>;
  deleteSession(input: DeleteSessionInput): Promise<WorkspaceState>;
  regenerateSessionMessage(input: RegenerateSessionMessageInput): Promise<void>;
  editAndResendSessionMessage(input: EditAndResendSessionMessageInput): Promise<void>;
  sendSessionMessage(input: SendSessionMessageInput): Promise<void>;
  cancelSessionTurn(input: CancelSessionTurnInput): Promise<void>;
  resolveSessionApproval(input: ResolveSessionApprovalInput): Promise<WorkspaceState>;
  resolveSessionUserInput(input: ResolveSessionUserInputInput): Promise<WorkspaceState>;
  setSessionInteractionMode(input: SetSessionInteractionModeInput): Promise<WorkspaceState>;
  dismissSessionPlanReview(input: DismissSessionPlanReviewInput): Promise<WorkspaceState>;
  dismissSessionMcpAuth(input: DismissSessionMcpAuthInput): Promise<WorkspaceState>;
  startSessionMcpAuth(input: StartSessionMcpAuthInput): Promise<WorkspaceState>;
  updateSessionModelConfig(input: UpdateSessionModelConfigInput): Promise<WorkspaceState>;
  querySessions(input: QuerySessionsInput): Promise<SessionQueryResult[]>;
  selectProject(projectId?: string): Promise<WorkspaceState>;
  selectPattern(patternId?: string): Promise<WorkspaceState>;
  selectSession(sessionId?: string): Promise<WorkspaceState>;
  setPatternFavorite(input: SetPatternFavoriteInput): Promise<WorkspaceState>;
  setTheme(theme: AppearanceTheme): Promise<WorkspaceState>;
  setTerminalHeight(input: SetTerminalHeightInput): Promise<WorkspaceState>;
  setNotificationsEnabled(enabled: boolean): Promise<WorkspaceState>;
  setMinimizeToTray(enabled: boolean): Promise<WorkspaceState>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  describeTerminal(): Promise<TerminalSnapshot | undefined>;
  createTerminal(): Promise<TerminalSnapshot>;
  restartTerminal(): Promise<TerminalSnapshot>;
  killTerminal(): Promise<void>;
  writeTerminal(data: string): void;
  resizeTerminal(input: ResizeTerminalInput): void;
  openAppDataFolder(): Promise<void>;
  resetLocalWorkspace(): Promise<WorkspaceState>;
  getQuota(): Promise<Record<string, QuotaSnapshot>>;
  onTerminalData(listener: (data: string) => void): () => void;
  onTerminalExit(listener: (info: TerminalExitInfo) => void): () => void;
  onWorkspaceUpdated(listener: (workspace: WorkspaceState) => void): () => void;
  onSessionEvent(listener: (event: SessionEventRecord) => void): () => void;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  onTrayCreateScratchpad(listener: () => void): () => void;
}

export interface RendererSelectionState {
  selectedProject?: ProjectRecord;
  selectedPattern?: PatternDefinition;
}
