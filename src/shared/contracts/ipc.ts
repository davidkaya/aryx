import type { ApprovalDecision } from '@shared/domain/approval';
import type { SidecarCapabilities, InteractionMode, MessageMode, QuotaSnapshot } from '@shared/contracts/sidecar';
import type { WorkflowExportFormat, WorkflowExportResult } from '@shared/domain/workflowSerialization';
import type { WorkflowTemplateCategory } from '@shared/domain/workflowTemplate';
import type { ReasoningEffort, WorkflowDefinition, WorkflowReference } from '@shared/domain/workflow';
import type {
  ProjectGitBranchSummary,
  ProjectGitCommitMessageSuggestion,
  ProjectGitDetails,
  ProjectGitDiffPreview,
  ProjectGitFileReference,
  ProjectRecord,
} from '@shared/domain/project';
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
import type { ProjectPromptInvocation } from '@shared/domain/projectCustomization';
import type { WorkspaceAgentDefinition } from '@shared/domain/workspaceAgent';

export interface CreateSessionInput {
  projectId: string;
  workflowId: string;
}

export type CreateWorkflowSessionInput = CreateSessionInput;

export interface SaveWorkflowInput {
  workflow: WorkflowDefinition;
}

export interface SaveWorkflowTemplateInput {
  workflowId: string;
  options?: {
    templateId?: string;
    name?: string;
    description?: string;
    category?: WorkflowTemplateCategory;
  };
}

export interface CreateWorkflowFromTemplateInput {
  templateId: string;
  options?: {
    workflowId?: string;
    name?: string;
    description?: string;
  };
}

export interface ExportWorkflowInput {
  workflowId: string;
  format: WorkflowExportFormat;
}

export interface ImportWorkflowInput {
  content: string;
  format: 'yaml' | 'json';
  options?: {
    save?: boolean;
  };
}

export interface ImportWorkflowResult {
  workflow: WorkflowDefinition;
  workspace?: WorkspaceState;
}

export interface SendSessionMessageInput {
  sessionId: string;
  content: string;
  attachments?: ChatMessageAttachment[];
  messageMode?: MessageMode;
  promptInvocation?: ProjectPromptInvocation;
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

export interface SaveMcpServerInput {
  server: McpServerDefinition;
}

export interface SaveLspProfileInput {
  profile: LspProfileDefinition;
}

export interface SaveWorkspaceAgentInput {
  agent: WorkspaceAgentDefinition;
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

export interface ProjectGitInput {
  projectId: string;
}

export interface ProjectGitDetailsInput extends ProjectGitInput {
  commitLimit?: number;
}

export interface ProjectGitFilePreviewInput extends ProjectGitInput {
  file: ProjectGitFileReference;
}

export interface ProjectGitFileSelectionInput extends ProjectGitInput {
  files: ProjectGitFileReference[];
}

export interface DiscardSessionRunGitChangesInput {
  sessionId: string;
  runId: string;
  files?: ProjectGitFileReference[];
}

export interface SuggestProjectGitCommitMessageInput {
  sessionId: string;
  runId?: string;
  conventionalType?: ProjectGitCommitMessageSuggestion['type'];
}

export interface CommitProjectGitChangesInput extends ProjectGitInput {
  message: string;
  files?: ProjectGitFileReference[];
  push?: boolean;
}

export interface PullProjectGitInput extends ProjectGitInput {
  rebase?: boolean;
}

export interface CreateProjectGitBranchInput extends ProjectGitInput {
  name: string;
  startPoint?: string;
  checkout?: boolean;
}

export interface SwitchProjectGitBranchInput extends ProjectGitInput {
  name: string;
}

export interface DeleteProjectGitBranchInput extends ProjectGitInput {
  name: string;
  force?: boolean;
}

export type UpdateStatusState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';

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
  saveWorkflow(input: SaveWorkflowInput): Promise<WorkspaceState>;
  saveWorkflowTemplate(input: SaveWorkflowTemplateInput): Promise<WorkspaceState>;
  deleteWorkflow(workflowId: string): Promise<WorkspaceState>;
  listWorkflowReferences(workflowId: string): Promise<WorkflowReference[]>;
  createWorkflowFromTemplate(input: CreateWorkflowFromTemplateInput): Promise<WorkspaceState>;
  exportWorkflow(input: ExportWorkflowInput): Promise<WorkflowExportResult>;
  importWorkflow(input: ImportWorkflowInput): Promise<ImportWorkflowResult>;
  saveMcpServer(input: SaveMcpServerInput): Promise<WorkspaceState>;
  deleteMcpServer(serverId: string): Promise<WorkspaceState>;
  saveLspProfile(input: SaveLspProfileInput): Promise<WorkspaceState>;
  deleteLspProfile(profileId: string): Promise<WorkspaceState>;
  saveWorkspaceAgent(input: SaveWorkspaceAgentInput): Promise<WorkspaceState>;
  deleteWorkspaceAgent(agentId: string): Promise<WorkspaceState>;
  updateSessionTooling(input: UpdateSessionToolingInput): Promise<WorkspaceState>;
  updateSessionApprovalSettings(input: UpdateSessionApprovalSettingsInput): Promise<WorkspaceState>;
  createSession(input: CreateSessionInput): Promise<WorkspaceState>;
  createWorkflowSession(input: CreateWorkflowSessionInput): Promise<WorkspaceState>;
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
  selectSession(sessionId?: string): Promise<WorkspaceState>;
  setTheme(theme: AppearanceTheme): Promise<WorkspaceState>;
  setTerminalHeight(input: SetTerminalHeightInput): Promise<WorkspaceState>;
  setNotificationsEnabled(enabled: boolean): Promise<WorkspaceState>;
  setMinimizeToTray(enabled: boolean): Promise<WorkspaceState>;
  setGitAutoRefreshEnabled(enabled: boolean): Promise<WorkspaceState>;
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
  getProjectGitDetails(input: ProjectGitDetailsInput): Promise<ProjectGitDetails>;
  getProjectGitFilePreview(input: ProjectGitFilePreviewInput): Promise<ProjectGitDiffPreview | undefined>;
  discardSessionRunGitChanges(input: DiscardSessionRunGitChangesInput): Promise<WorkspaceState>;
  stageProjectGitFiles(input: ProjectGitFileSelectionInput): Promise<WorkspaceState>;
  unstageProjectGitFiles(input: ProjectGitFileSelectionInput): Promise<WorkspaceState>;
  suggestProjectGitCommitMessage(input: SuggestProjectGitCommitMessageInput): Promise<ProjectGitCommitMessageSuggestion>;
  commitProjectGitChanges(input: CommitProjectGitChangesInput): Promise<WorkspaceState>;
  pushProjectGit(input: ProjectGitInput): Promise<WorkspaceState>;
  fetchProjectGit(input: ProjectGitInput): Promise<WorkspaceState>;
  pullProjectGit(input: PullProjectGitInput): Promise<WorkspaceState>;
  createProjectGitBranch(input: CreateProjectGitBranchInput): Promise<WorkspaceState>;
  switchProjectGitBranch(input: SwitchProjectGitBranchInput): Promise<WorkspaceState>;
  deleteProjectGitBranch(input: DeleteProjectGitBranchInput): Promise<WorkspaceState>;
  onTerminalData(listener: (data: string) => void): () => void;
  onTerminalExit(listener: (info: TerminalExitInfo) => void): () => void;
  onWorkspaceUpdated(listener: (workspace: WorkspaceState) => void): () => void;
  onSessionEvent(listener: (event: SessionEventRecord) => void): () => void;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  onTrayCreateScratchpad(listener: () => void): () => void;
}

export interface RendererSelectionState {
  selectedProject?: ProjectRecord;
  selectedWorkflow?: WorkflowDefinition;
}
