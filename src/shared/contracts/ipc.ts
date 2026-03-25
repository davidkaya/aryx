import type { ApprovalDecision } from '@shared/domain/approval';
import type { SidecarCapabilities } from '@shared/contracts/sidecar';
import type { PatternDefinition, ReasoningEffort } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { QuerySessionsInput, SessionQueryResult } from '@shared/domain/sessionLibrary';
import type { SessionEventRecord } from '@shared/domain/event';
import type {
  LspProfileDefinition,
  McpServerDefinition,
  SessionToolingSelection,
  AppearanceTheme,
} from '@shared/domain/tooling';
import type { WorkspaceState } from '@shared/domain/workspace';

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
}

export interface CancelSessionTurnInput {
  sessionId: string;
}

export interface ResolveSessionApprovalInput {
  sessionId: string;
  approvalId: string;
  decision: ApprovalDecision;
}

export interface UpdateSessionModelConfigInput {
  sessionId: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface DuplicateSessionInput {
  sessionId: string;
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

export interface ResolveProjectDiscoveredToolingInput {
  projectId: string;
  serverIds: string[];
  resolution: DiscoveredToolingResolution;
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

export interface ElectronApi {
  describeSidecarCapabilities(): Promise<SidecarCapabilities>;
  refreshSidecarCapabilities(): Promise<SidecarCapabilities>;
  loadWorkspace(): Promise<WorkspaceState>;
  addProject(): Promise<WorkspaceState>;
  removeProject(projectId: string): Promise<WorkspaceState>;
  resolveWorkspaceDiscoveredTooling(input: ResolveWorkspaceDiscoveredToolingInput): Promise<WorkspaceState>;
  refreshProjectGitContext(projectId?: string): Promise<WorkspaceState>;
  rescanProjectConfigs(input: RescanProjectConfigsInput): Promise<WorkspaceState>;
  resolveProjectDiscoveredTooling(input: ResolveProjectDiscoveredToolingInput): Promise<WorkspaceState>;
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
  renameSession(input: RenameSessionInput): Promise<WorkspaceState>;
  setSessionPinned(input: SetSessionPinnedInput): Promise<WorkspaceState>;
  setSessionArchived(input: SetSessionArchivedInput): Promise<WorkspaceState>;
  sendSessionMessage(input: SendSessionMessageInput): Promise<void>;
  cancelSessionTurn(input: CancelSessionTurnInput): Promise<void>;
  resolveSessionApproval(input: ResolveSessionApprovalInput): Promise<WorkspaceState>;
  updateSessionModelConfig(input: UpdateSessionModelConfigInput): Promise<WorkspaceState>;
  querySessions(input: QuerySessionsInput): Promise<SessionQueryResult[]>;
  selectProject(projectId?: string): Promise<WorkspaceState>;
  selectPattern(patternId?: string): Promise<WorkspaceState>;
  selectSession(sessionId?: string): Promise<WorkspaceState>;
  setPatternFavorite(input: SetPatternFavoriteInput): Promise<WorkspaceState>;
  setTheme(theme: AppearanceTheme): Promise<WorkspaceState>;
  openAppDataFolder(): Promise<void>;
  resetLocalWorkspace(): Promise<WorkspaceState>;
  onWorkspaceUpdated(listener: (workspace: WorkspaceState) => void): () => void;
  onSessionEvent(listener: (event: SessionEventRecord) => void): () => void;
}

export interface RendererSelectionState {
  selectedProject?: ProjectRecord;
  selectedPattern?: PatternDefinition;
}
