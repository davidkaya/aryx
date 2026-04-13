import { EventEmitter } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import electron from 'electron';

import type {
  AgentActivityEvent,
  ApprovalRequestedEvent,
  ExitPlanModeRequestedEvent,
  InteractionMode,
  MessageMode,
  McpOauthRequiredEvent,
  MessageReclassifiedEvent,
  RunTurnCustomAgentConfig,
  RunTurnCommand,
  RunTurnToolingConfig,
  SidecarCapabilities,
  UserInputRequestedEvent,
  TurnDeltaEvent,
  WorkflowCheckpointResume,
  WorkflowCheckpointSavedEvent,
} from '@shared/contracts/sidecar';
import type { TurnScopedEvent } from '@main/sidecar/runTurnPending';
import {
  buildAvailableModelCatalog,
  findModel,
  findModelByReference,
  normalizeWorkflowModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import {
  buildWorkflowExecutionDefinition,
  isReasoningEffort,
  resolveWorkflowAgentNodes,
  type ReasoningEffort,
  type WorkflowDefinition,
  type WorkflowReference,
} from '@shared/domain/workflow';
import {
  exportWorkflowDefinition,
  importWorkflowDefinition,
  type WorkflowExportFormat,
  type WorkflowExportResult,
} from '@shared/domain/workflowSerialization';
import {
  applyWorkflowTemplate,
  type WorkflowTemplateCategory,
  type WorkflowTemplateDefinition,
} from '@shared/domain/workflowTemplate';
import {
  normalizeWorkspaceAgentDefinition,
  resolveWorkflowAgents as resolveWorkspaceWorkflowAgents,
  type WorkspaceAgentDefinition,
} from '@shared/domain/workspaceAgent';
import {
  applyDiscoveredMcpServerStatus,
  listAcceptedDiscoveredMcpServers,
  normalizeDiscoveredToolingState,
  type DiscoveredMcpServer,
  type DiscoveredToolingState,
  type DiscoveredToolingStatus,
} from '@shared/domain/discoveredTooling';
import {
  listEnabledProjectAgentProfiles,
  normalizeProjectPromptInvocation,
  normalizeProjectCustomizationState,
  resolveProjectInstructionsContent,
  setProjectAgentProfileEnabled,
  type ProjectAgentProfile,
  type ProjectPromptFile,
  type ProjectPromptInvocation,
  type ProjectCustomizationState,
} from '@shared/domain/projectCustomization';
import {
  applyDefaultToolApprovalPolicy,
  approvalPolicyRequiresCheckpoint,
  listPendingApprovals,
  normalizeApprovalPolicy,
  normalizeSessionApprovalSettings,
  pruneApprovalPolicyTools,
  pruneSessionApprovalSettings,
  type ApprovalDecision,
  type PendingApprovalMessageRecord,
  type PendingApprovalRecord,
} from '@shared/domain/approval';
import {
  isScratchpadProject,
  type ProjectGitCommitMessageSuggestion,
  type ProjectGitDetails,
  type ProjectGitDiffPreview,
  type ProjectGitFileReference,
  type ProjectRecord,
} from '@shared/domain/project';
import {
  branchSessionRecord,
  duplicateSessionRecord,
  editAndResendSessionRecord,
  querySessions as queryWorkspaceSessions,
  regenerateSessionRecord,
  renameSessionRecord,
  setSessionMessagePinnedRecord,
  type QuerySessionsInput,
  type SessionQueryResult,
} from '@shared/domain/sessionLibrary';
import type { SessionEventRecord } from '@shared/domain/event';
import type { TerminalExitInfo, TerminalSnapshot } from '@shared/domain/terminal';
import type { ChatMessageAttachment } from '@shared/domain/attachment';
import {
  applySessionApprovalSettings,
  applySessionModelConfig,
  resolveSessionToolingSelection,
  createSessionModelConfig,
  resolveSessionTitle,
  type ChatMessageRecord,
  type SessionRecord,
} from '@shared/domain/session';
import { prepareChatMessageContent } from '@shared/utils/chatMessage';
import {
  appendRunActivityEvent,
  cancelSessionRunRecord,
  completeSessionRunRecord,
  createSessionRunRecord,
  failSessionRunRecord,
  setSessionRunGitSummary,
  upsertRunApprovalEvent,
  upsertRunMessageEvent,
  upsertSessionRunRecord,
  type CreateSessionRunRecordInput,
  type RunTimelineEventRecord,
  type SessionRunRecord,
} from '@shared/domain/runTimeline';
import {
  createSessionToolingSelection,
  listApprovalToolNames,
  normalizeTerminalHeight,
  normalizeTheme,
  resolveProjectToolingSettings,
  resolveWorkspaceToolingSettings,
  type AppearanceTheme,
  type LspProfileDefinition,
  type McpServerDefinition,
  type SessionToolingSelection,
  type WorkspaceToolingSettings,
  normalizeLspProfileDefinition,
  normalizeMcpServerDefinition,
  normalizeSessionToolingSelection,
  validateLspProfileDefinition,
  validateMcpServerDefinition,
} from '@shared/domain/tooling';
import type { WorkspaceState } from '@shared/domain/workspace';
import { createId, nowIso } from '@shared/utils/ids';
import { mergeStreamingText } from '@shared/utils/streamingText';

import { WorkspaceRepository } from '@main/persistence/workspaceRepository';
import { getScratchpadSessionPath } from '@main/persistence/appPaths';
import { SecretStore } from '@main/secrets/secretStore';
import { ConfigScannerRegistry } from '@main/services/configScanner';
import { ProjectCustomizationScanner } from '@main/services/customizationScanner';
import { ProjectCustomizationWatcher } from '@main/services/projectCustomizationWatcher';
import {
  SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE,
  SidecarClient,
} from '@main/sidecar/sidecarProcess';
import { TurnCancelledError } from '@main/sidecar/turnCancelledError';
import { buildProjectGitCommitMessageSuggestion } from '@main/git/gitCommitMessageSuggestion';
import { GitService } from '@main/git/gitService';
import {
  buildRunTurnToolingConfig as buildSessionToolingConfig,
  validateSessionToolingSelectionIds,
} from '@main/sessionToolingConfig';
import { getStoredToken } from '@main/services/mcpTokenStore';
import { performMcpOAuthFlow, requiresOAuth } from '@main/services/mcpOAuthService';
import { probeServers, type McpProbeResult } from '@main/services/mcpToolProber';
import {
  DiscoveredToolingSyncService,
  type DiscoveredToolingResolution,
} from '@main/services/discoveredToolingSyncService';
import {
  ApprovalCoordinator,
} from '@main/services/approvalCoordinator';
import {
  CheckpointRecoveryManager,
  type WorkflowCheckpointRecoveryState,
} from '@main/services/checkpointRecoveryManager';
import { GitContextManager } from '@main/services/gitContextManager';
import { McpProbeManager } from '@main/services/mcpProbeManager';
import { PtyManager } from '@main/services/ptyManager';
import { SessionTurnExecutor } from '@main/services/sessionTurnExecutor';
import { WorkflowManager } from '@main/services/workflowManager';

const { dialog, shell } = electron;

type AppServiceEvents = {
  'workspace-updated': [WorkspaceState];
  'session-event': [SessionEventRecord];
  'terminal-data': [string];
  'terminal-exit': [TerminalExitInfo];
};

export type AppServiceDeps = {
  workspaceRepository: WorkspaceRepository;
  sidecar: SidecarClient;
  secretStore: SecretStore;
  gitService: GitService;
  configScanner: ConfigScannerRegistry;
  customizationScanner: ProjectCustomizationScanner;
  projectCustomizationWatcher: ProjectCustomizationWatcher;
  probeMcpServers: typeof probeServers;
  ptyManager: PtyManager;
};

function equalStringArrays(left?: readonly string[], right?: readonly string[]): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function buildPromptInvocationFallbackContent(promptInvocation?: ProjectPromptInvocation): string | undefined {
  if (!promptInvocation) {
    return undefined;
  }

  return `Run prompt file: ${promptInvocation.name}`;
}

function hydratePromptInvocationMetadata(
  promptInvocation: ProjectPromptInvocation | undefined,
  projectCustomization: ProjectCustomizationState | undefined,
): ProjectPromptInvocation | undefined {
  if (!promptInvocation) {
    return undefined;
  }

  const matchingPromptFile = findMatchingPromptFile(projectCustomization?.promptFiles, promptInvocation);
  if (!matchingPromptFile) {
    return promptInvocation;
  }

  return normalizeProjectPromptInvocation({
    ...promptInvocation,
    description: promptInvocation.description ?? matchingPromptFile.description,
    agent: promptInvocation.agent ?? matchingPromptFile.agent,
    model: promptInvocation.model ?? matchingPromptFile.model,
    tools: promptInvocation.tools ?? matchingPromptFile.tools,
  });
}

function findMatchingPromptFile(
  promptFiles: ReadonlyArray<ProjectPromptFile> | undefined,
  promptInvocation: ProjectPromptInvocation,
): ProjectPromptFile | undefined {
  if (!promptFiles || promptFiles.length === 0) {
    return undefined;
  }

  return promptFiles.find((promptFile) => promptFile.id === promptInvocation.id)
    ?? promptFiles.find((promptFile) => promptFile.sourcePath === promptInvocation.sourcePath);
}

function isPlanPromptInvocation(promptInvocation?: ProjectPromptInvocation): boolean {
  return promptInvocation?.agent?.trim().toLowerCase() === 'plan';
}

function isSidecarStoppedBeforeCompletionError(error: unknown): error is Error {
  return error instanceof Error && error.message === SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE;
}

function isUnexpectedSidecarTerminationError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  const { message } = error;
  return isSidecarStoppedBeforeCompletionError(error)
    || message.startsWith('The .NET sidecar exited unexpectedly with code ');
}

const INTERRUPTED_RUN_ERROR =
  'This session was interrupted because Aryx restarted while a run was in progress.';
const INTERRUPTED_APPROVAL_ERROR =
  'Pending approval was interrupted because Aryx restarted before a decision was recorded.';
const GIT_REFRESH_DEBOUNCE_MS = 750;
const GIT_REFRESH_INTERVAL_MS = 60_000;

export class AryxAppService extends EventEmitter<AppServiceEvents> {
  private readonly workspaceRepository: WorkspaceRepository;
  private readonly sidecar: SidecarClient;
  private readonly secretStore: SecretStore;
  private readonly gitService: GitService;
  private readonly configScanner: ConfigScannerRegistry;
  private readonly customizationScanner: ProjectCustomizationScanner;
  private readonly projectCustomizationWatcher: ProjectCustomizationWatcher;
  private readonly probeMcpServers: typeof probeServers;
  private readonly ptyManager: PtyManager;
  private readonly workflowManager: WorkflowManager;
  private readonly mcpProbeManager: McpProbeManager;
  private readonly discoveredToolingSyncService: DiscoveredToolingSyncService;
  private readonly gitContextManager: GitContextManager;
  private readonly approvalCoordinator: ApprovalCoordinator;
  private readonly checkpointRecoveryManager: CheckpointRecoveryManager;
  private readonly sessionTurnExecutor: SessionTurnExecutor;
  private readonly workflowCheckpointRecoveries: Map<string, WorkflowCheckpointRecoveryState>;
  private workspace?: WorkspaceState;
  private sidecarCapabilities?: SidecarCapabilities;
  private sidecarCapabilitiesPromise?: Promise<SidecarCapabilities>;
  private didScheduleInitialProjectGitRefresh = false;
  private didStartPeriodicProjectGitRefresh = false;
  private mcpProbeUpdateQueue = Promise.resolve();
  private pendingProjectGitRefreshIds = new Set<string>();
  private pendingRefreshAllProjects = false;
  private projectGitRefreshTimer?: ReturnType<typeof setTimeout>;
  private periodicProjectGitRefreshTimer?: ReturnType<typeof setInterval>;
  private runningProjectGitRefresh?: Promise<void>;
  private customizationWatcherUpdateQueue = Promise.resolve();

  constructor(deps: Partial<AppServiceDeps> = {}) {
    super();

    this.workspaceRepository = deps.workspaceRepository ?? new WorkspaceRepository();
    this.sidecar = deps.sidecar ?? new SidecarClient();
    this.secretStore = deps.secretStore ?? new SecretStore();
    this.gitService = deps.gitService ?? new GitService();
    this.configScanner = deps.configScanner ?? new ConfigScannerRegistry();
    this.customizationScanner = deps.customizationScanner ?? new ProjectCustomizationScanner();
    this.projectCustomizationWatcher = deps.projectCustomizationWatcher
      ?? new ProjectCustomizationWatcher((projectId) => this.handleProjectCustomizationWatcherChange(projectId));
    this.probeMcpServers = deps.probeMcpServers ?? probeServers;
    this.ptyManager = deps.ptyManager ?? new PtyManager();
    this.workflowManager = new WorkflowManager();
    this.mcpProbeManager = new McpProbeManager({
      loadWorkspace: () => this.loadWorkspace(),
      persistWorkspace: async (workspace) => {
        await this.persistAndBroadcast(workspace);
      },
      probeMcpServers: this.probeMcpServers,
      tokenLookup: (serverUrl) => getStoredToken(serverUrl)?.accessToken,
      performMcpOAuthFlow,
      requiresOAuth,
    });
    this.discoveredToolingSyncService = new DiscoveredToolingSyncService({
      configScanner: this.configScanner,
      customizationScanner: this.customizationScanner,
      projectCustomizationWatcher: this.projectCustomizationWatcher,
      loadWorkspace: () => this.loadWorkspace(),
      persistWorkspace: async (workspace) => {
        await this.persistAndBroadcast(workspace);
      },
    });
    this.gitContextManager = new GitContextManager({
      gitService: this.gitService,
      loadWorkspace: () => this.loadWorkspace(),
      persistWorkspace: (workspace) => this.persistAndBroadcast(workspace),
      requireProject: (workspace, projectId) => this.requireProject(workspace, projectId),
      requireSession: (workspace, sessionId) => this.requireSession(workspace, sessionId),
      requireSessionRun: (session, runId) => this.requireSessionRun(session, runId),
      syncProjectDiscoveredTooling: (workspace, project) => this.syncProjectDiscoveredTooling(workspace, project),
      syncProjectCustomization: (project) => this.syncProjectCustomization(project),
      pruneUnavailableSessionToolingSelections: (workspace) => this.pruneUnavailableSessionToolingSelections(workspace),
      pruneUnavailableApprovalTools: (workspace) => this.pruneUnavailableApprovalTools(workspace),
      updateSessionRun: (session, requestId, updater) => this.updateSessionRun(session, requestId, updater),
      emitRunUpdated: (sessionId, occurredAt, run) => this.emitRunUpdated(sessionId, occurredAt, run),
    });
    this.approvalCoordinator = new ApprovalCoordinator({
      requireSession: (workspace, sessionId) => this.requireSession(workspace, sessionId),
      persistWorkspace: (workspace) => this.persistAndBroadcast(workspace),
      updateSessionRun: (session, requestId, updater) => this.updateSessionRun(session, requestId, updater),
      emitRunUpdated: (sessionId, occurredAt, run) => this.emitRunUpdated(sessionId, occurredAt, run),
      emitSessionEvent: (event) => this.emitSessionEvent(event),
      failSessionRunRecord: (run, failedAt, error) => failSessionRunRecord(run, failedAt, error),
      upsertRunApprovalEvent: (run, approval) => upsertRunApprovalEvent(run, approval),
    });
    this.checkpointRecoveryManager = new CheckpointRecoveryManager({
      persistWorkspace: async (workspace) => {
        await this.persistAndBroadcast(workspace);
      },
      emitRunUpdated: (sessionId, occurredAt, run) => this.emitRunUpdated(sessionId, occurredAt, run),
      updateSessionRun: (session, requestId, updater) => this.updateSessionRun(session, requestId, updater),
      setSessionPendingApprovalState: (session, state) => this.approvalCoordinator.setSessionPendingApprovalState(session, state),
      pendingApprovalHandles: this.approvalCoordinator.pendingApprovalHandles,
      pendingUserInputHandles: this.approvalCoordinator.pendingUserInputHandles,
    });
    this.sessionTurnExecutor = new SessionTurnExecutor({
      saveWorkspace: async (workspace) => {
        await this.workspaceRepository.save(workspace);
      },
      persistWorkspace: (workspace) => this.persistAndBroadcast(workspace),
      requireSession: (workspace, sessionId) => this.requireSession(workspace, sessionId),
      resolveSessionWorkflow: (workspace, session) => this.resolveSessionWorkflow(workspace, session),
      updateSessionRun: (session, requestId, updater) => this.updateSessionRun(session, requestId, updater),
      emitRunUpdated: (sessionId, occurredAt, run) => this.emitRunUpdated(sessionId, occurredAt, run),
      emitSessionEvent: (event) => this.emitSessionEvent(event),
      rejectPendingApprovals: (session, failedAt, error) => this.rejectPendingApprovals(session, failedAt, error),
      buildRunTurnToolingConfig: (workspace, session) => this.buildRunTurnToolingConfig(workspace, session),
      runSidecarTurnWithCheckpointRecovery: (
        workspace,
        session,
        requestId,
        createCommand,
        onDelta,
        onActivity,
        onApproval,
        onUserInput,
        onMcpOAuthRequired,
        onExitPlanMode,
        onMessageReclassified,
        onTurnScopedEvent,
      ) => this.runSidecarTurnWithCheckpointRecovery(
        workspace,
        session,
        requestId,
        createCommand,
        onDelta,
        onActivity,
        onApproval,
        onUserInput,
        onMcpOAuthRequired,
        onExitPlanMode,
        onMessageReclassified,
        onTurnScopedEvent,
      ),
      handleApprovalRequested: (workspace, sessionId, requestId, approval, resolve) =>
        this.handleApprovalRequested(workspace, sessionId, requestId, approval, resolve),
      handleUserInputRequested: (workspace, sessionId, requestId, event, resolve) =>
        this.handleUserInputRequested(workspace, sessionId, requestId, event, resolve),
      handleMcpOAuthRequired: (workspace, sessionId, event) =>
        this.handleMcpOAuthRequired(workspace, sessionId, event),
      handleExitPlanModeRequested: (workspace, sessionId, event) =>
        this.handleExitPlanModeRequested(workspace, sessionId, event),
      handleTurnScopedEvent: (workspace, sessionId, event) =>
        this.handleTurnScopedEvent(workspace, sessionId, event),
      sidecarResolveApproval: (approvalId, decision, alwaysApprove) =>
        this.sidecar.resolveApproval(approvalId, decision, alwaysApprove),
      sidecarResolveUserInput: (userInputId, answer, wasFreeform) =>
        this.sidecar.resolveUserInput(userInputId, answer, wasFreeform),
      captureWorkingTreeSnapshot: (projectPath, scannedAt) =>
        this.gitService.captureWorkingTreeSnapshot(projectPath, scannedAt),
      captureWorkingTreeBaseline: (projectPath, snapshot) =>
        this.gitService.captureWorkingTreeBaseline(projectPath, snapshot),
      refreshSessionRunGitSummary: (session, project, requestId, occurredAt) =>
        this.refreshSessionRunGitSummary(session, project, requestId, occurredAt),
      cleanupWorkflowCheckpointRecovery: (requestId) =>
        this.cleanupWorkflowCheckpointRecovery(requestId),
      scheduleProjectGitRefresh: (projectId) => this.scheduleProjectGitRefresh(projectId),
      loadAvailableModelCatalog: () => this.loadAvailableModelCatalog(),
    });
    this.workflowCheckpointRecoveries = this.checkpointRecoveryManager.recoveries;

    this.ptyManager.on('data', (data) => {
      this.emit('terminal-data', data);
    });
    this.ptyManager.on('exit', (info) => {
      this.emit('terminal-exit', info);
    });
  }

  async describeSidecarCapabilities(): Promise<SidecarCapabilities> {
    return this.loadSidecarCapabilities();
  }

  async refreshSidecarCapabilities(): Promise<SidecarCapabilities> {
    return this.loadSidecarCapabilities(true);
  }

  async loadWorkspace(): Promise<WorkspaceState> {
    if (!this.workspace) {
      this.workspace = await this.workspaceRepository.load();
      const selectedProjectId = this.workspace.selectedProjectId;
      const selectedProject = selectedProjectId
        ? this.workspace.projects.find((project) => project.id === selectedProjectId)
        : undefined;

      // Run independent sync operations in parallel
      const [didSyncUserTooling, didSyncProjectTooling, didSyncProjectCustomization] = await Promise.all([
        this.syncUserDiscoveredTooling(this.workspace),
        selectedProject
          ? this.syncProjectDiscoveredTooling(this.workspace, selectedProject)
          : false,
        selectedProject
          ? this.syncProjectCustomization(selectedProject)
          : false,
      ]);

      const didPruneSelections = this.pruneUnavailableSessionToolingSelections(this.workspace);
      if (
        didSyncUserTooling
        || didSyncProjectTooling
        || didSyncProjectCustomization
        || didPruneSelections
        || this.cleanupInterruptedSessions(this.workspace)
      ) {
        await this.workspaceRepository.save(this.workspace);
      }

      await this.syncProjectCustomizationWatchers(this.workspace);

      // Defer sidecar-dependent approval pruning so it doesn't block startup.
      // This runs in the background and emits workspace-updated when done.
      void this.pruneUnavailableApprovalTools(this.workspace)
        .then(async (didPrune) => {
          if (didPrune && this.workspace) {
            await this.workspaceRepository.save(this.workspace);
            this.emit('workspace-updated', this.workspace);
          }
        })
        .catch((error) => {
          console.error('[aryx startup] deferred approval tool pruning failed', error);
        });
    }

    if (!this.didScheduleInitialProjectGitRefresh) {
      this.didScheduleInitialProjectGitRefresh = true;
      if (this.workspace.settings.gitAutoRefreshEnabled !== false) {
        this.startPeriodicProjectGitRefresh();
      }
      void this.refreshProjectGitContext().catch((error) => {
        console.error('[aryx git]', error);
      });

      void this.probeAllAcceptedMcpServers(this.workspace).catch((error) => {
        console.error('[aryx mcp-probe]', error);
      });
    }

    return this.workspace;
  }

  /** Returns the in-memory workspace without loading from disk. Used for synchronous checks. */
  getCachedWorkspace(): WorkspaceState | undefined {
    return this.workspace;
  }

  async dispose(): Promise<void> {
    this.gitContextManager.dispose();
    this.projectCustomizationWatcher.dispose();
    this.ptyManager.dispose();
    await this.sidecar.dispose();
    void this.secretStore;
  }

  isGitAutoRefreshEnabled(): boolean {
    return this.workspace?.settings.gitAutoRefreshEnabled !== false;
  }

  scheduleProjectGitRefresh(projectId?: string): void {
    this.gitContextManager.scheduleProjectGitRefresh(projectId);
  }

  async openAppDataFolder(): Promise<void> {
    const appDataPath = dirname(this.workspaceRepository.filePath);
    await shell.openPath(appDataPath);
  }

  async resetLocalWorkspace(): Promise<WorkspaceState> {
    this.projectCustomizationWatcher.dispose();
    await this.sidecar.dispose();

    try {
      await rm(this.workspaceRepository.filePath, { force: true });
      await rm(this.workspaceRepository.scratchpadPath, { recursive: true, force: true });
    } catch (error) {
      console.error('[aryx reset]', error);
    }

    this.workspace = undefined;
    this.sidecarCapabilities = undefined;
    this.sidecarCapabilitiesPromise = undefined;
    this.didScheduleInitialProjectGitRefresh = false;

    const workspace = await this.loadWorkspace();
    this.emit('workspace-updated', workspace);
    return workspace;
  }

  async addProject(): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const result = await dialog.showOpenDialog({
      title: 'Open project folder',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return workspace;
    }

    const folderPath = result.filePaths[0];
    const existing = workspace.projects.find((project) => project.path === folderPath);
    if (existing) {
      workspace.selectedProjectId = existing.id;
      const didSyncProjectTooling = await this.syncProjectDiscoveredTooling(workspace, existing);
      await this.syncProjectCustomization(existing);
      await this.syncProjectCustomizationWatchers(workspace);
      if (didSyncProjectTooling) {
        this.pruneUnavailableSessionToolingSelections(workspace);
        await this.pruneUnavailableApprovalTools(workspace);
      }
      return this.persistAndBroadcast(workspace);
    }

    const project: ProjectRecord = {
      id: createId('project'),
      name: basename(folderPath),
      path: folderPath,
      addedAt: nowIso(),
      git: await this.gitService.describeProject(folderPath),
    };

    workspace.projects.push(project);
    workspace.selectedProjectId = project.id;
    await this.syncProjectDiscoveredTooling(workspace, project);
    await this.syncProjectCustomization(project);
    await this.syncProjectCustomizationWatchers(workspace);
    return this.persistAndBroadcast(workspace);
  }

  async removeProject(projectId: string): Promise<WorkspaceState> {
    if (isScratchpadProject(projectId)) {
      throw new Error('Scratchpad cannot be removed.');
    }

    const workspace = await this.loadWorkspace();
    workspace.projects = workspace.projects.filter((project) => project.id !== projectId);
    workspace.sessions = workspace.sessions.filter((session) => session.projectId !== projectId);

    if (workspace.selectedProjectId === projectId) {
      workspace.selectedProjectId = workspace.projects[0]?.id;
    }

    if (
      workspace.selectedSessionId &&
      !workspace.sessions.some((session) => session.id === workspace.selectedSessionId)
    ) {
      workspace.selectedSessionId = undefined;
    }

    await this.syncProjectCustomizationWatchers(workspace);
    return this.persistAndBroadcast(workspace);
  }

  async resolveWorkspaceDiscoveredTooling(
    serverIds: string[],
    resolution: DiscoveredToolingResolution,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    this.discoveredToolingSyncService.resolveWorkspaceDiscoveredTooling(workspace, serverIds, resolution);

    this.pruneUnavailableSessionToolingSelections(workspace);
    await this.pruneUnavailableApprovalTools(workspace);
    const result = await this.persistAndBroadcast(workspace);

    if (resolution === 'accept') {
      void this.probeDiscoveredMcpServers(workspace, workspace.settings.discoveredUserTooling, serverIds).catch((error) => {
        console.error('[aryx mcp-probe]', error);
      });
    }

    return result;
  }

  async rescanProjectConfigs(projectId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    await this.discoveredToolingSyncService.syncProjectDiscoveredTooling(workspace, project);
    this.pruneUnavailableSessionToolingSelections(workspace);
    await this.pruneUnavailableApprovalTools(workspace);
    const result = await this.persistAndBroadcast(workspace);

    void this.probeDiscoveredMcpServersFromState(workspace, project.discoveredTooling).catch((error) => {
      console.error('[aryx mcp-probe]', error);
    });

    return result;
  }

  async rescanProjectCustomization(projectId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    await this.discoveredToolingSyncService.syncProjectCustomization(project);
    await this.discoveredToolingSyncService.syncProjectCustomizationWatchers(workspace);
    return this.persistAndBroadcast(workspace);
  }

  async setProjectAgentProfileEnabled(
    projectId: string,
    agentProfileId: string,
    enabled: boolean,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    project.customization = setProjectAgentProfileEnabled(
      project.customization,
      agentProfileId,
      enabled,
    );
    return this.persistAndBroadcast(workspace);
  }

  async resolveProjectDiscoveredTooling(
    projectId: string,
    serverIds: string[],
    resolution: DiscoveredToolingResolution,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    this.discoveredToolingSyncService.resolveProjectDiscoveredTooling(project, serverIds, resolution);

    this.pruneUnavailableSessionToolingSelections(workspace);
    await this.pruneUnavailableApprovalTools(workspace);
    const result = await this.persistAndBroadcast(workspace);

    if (resolution === 'accept') {
      void this.probeDiscoveredMcpServers(workspace, project.discoveredTooling, serverIds).catch((error) => {
        console.error('[aryx mcp-probe]', error);
      });
    }

    return result;
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    this.workflowManager.saveWorkflow(workspace, workflow);
    return this.persistAndBroadcast(workspace);
  }

  async saveWorkflowTemplate(
    workflowId: string,
    options?: {
      templateId?: string;
      name?: string;
      description?: string;
      category?: WorkflowTemplateCategory;
    },
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    this.workflowManager.saveWorkflowTemplate(workspace, workflowId, options);
    return this.persistAndBroadcast(workspace);
  }

  async createWorkflowFromTemplate(
    templateId: string,
    options?: {
      workflowId?: string;
      name?: string;
      description?: string;
    },
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    this.workflowManager.createWorkflowFromTemplate(workspace, templateId, options);
    return this.persistAndBroadcast(workspace);
  }

  async exportWorkflow(workflowId: string, format: WorkflowExportFormat): Promise<WorkflowExportResult> {
    const workspace = await this.loadWorkspace();
    return this.workflowManager.exportWorkflow(workspace, workflowId, format);
  }

  async importWorkflow(
    content: string,
    format: 'yaml' | 'json',
    options?: { save?: boolean },
  ): Promise<{ workflow: WorkflowDefinition; workspace?: WorkspaceState }> {
    const workflow = this.workflowManager.importWorkflow(content, format);
    if (!options?.save) {
      return { workflow };
    }

    const workspace = await this.loadWorkspace();
    this.workflowManager.saveWorkflow(workspace, workflow);
    const persistedWorkspace = await this.persistAndBroadcast(workspace);
    return {
      workflow,
      workspace: persistedWorkspace,
    };
  }

  async setTheme(theme: AppearanceTheme): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.theme = normalizeTheme(theme);
    return this.persistAndBroadcast(workspace);
  }

  async setTerminalHeight(height?: number): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const normalizedHeight = normalizeTerminalHeight(height);

    if (normalizedHeight === undefined) {
      if (workspace.settings.terminalHeight === undefined) {
        return workspace;
      }

      delete workspace.settings.terminalHeight;
      return this.persistAndBroadcast(workspace);
    }

    if (workspace.settings.terminalHeight === normalizedHeight) {
      return workspace;
    }

    workspace.settings.terminalHeight = normalizedHeight;
    return this.persistAndBroadcast(workspace);
  }

  async setNotificationsEnabled(enabled: boolean): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.notificationsEnabled = enabled;
    return this.persistAndBroadcast(workspace);
  }

  async setMinimizeToTray(enabled: boolean): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.minimizeToTray = enabled;
    return this.persistAndBroadcast(workspace);
  }

  async setGitAutoRefreshEnabled(enabled: boolean): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.gitAutoRefreshEnabled = enabled;

    if (enabled) {
      this.startPeriodicProjectGitRefresh();
    } else {
      this.stopPeriodicProjectGitRefresh();
    }

    return this.persistAndBroadcast(workspace);
  }

  async describeTerminal(): Promise<TerminalSnapshot | undefined> {
    return this.ptyManager.getSnapshot();
  }

  async createTerminal(): Promise<TerminalSnapshot> {
    const workspace = await this.loadWorkspace();
    return this.ptyManager.create(this.resolveTerminalWorkingDirectory(workspace));
  }

  async restartTerminal(): Promise<TerminalSnapshot> {
    const workspace = await this.loadWorkspace();
    return this.ptyManager.restart(this.resolveTerminalWorkingDirectory(workspace));
  }

  async killTerminal(): Promise<void> {
    this.ptyManager.kill();
  }

  writeTerminal(data: string): void {
    this.ptyManager.write(data);
  }

  resizeTerminal(cols: number, rows: number): void {
    this.ptyManager.resize(cols, rows);
  }

  async deleteWorkflow(workflowId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    this.workflowManager.deleteWorkflow(workspace, workflowId);
    return this.persistAndBroadcast(workspace);
  }

  async listWorkflowReferences(workflowId: string): Promise<WorkflowReference[]> {
    const workspace = await this.loadWorkspace();
    return this.workflowManager.listWorkflowReferences(workspace, workflowId);
  }

  async saveMcpServer(server: McpServerDefinition): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const existingIndex = workspace.settings.tooling.mcpServers.findIndex(
      (current) => current.id === server.id,
    );
    const timestamp = nowIso();
    const candidate = normalizeMcpServerDefinition({
      ...server,
      createdAt:
        existingIndex >= 0
          ? workspace.settings.tooling.mcpServers[existingIndex].createdAt
          : timestamp,
      updatedAt: timestamp,
    });
    const issue = validateMcpServerDefinition(candidate);
    if (issue) {
      throw new Error(issue);
    }

    if (existingIndex >= 0) {
      workspace.settings.tooling.mcpServers[existingIndex] = candidate;
    } else {
      workspace.settings.tooling.mcpServers.push(candidate);
    }

    await this.pruneUnavailableApprovalTools(workspace);
    return this.persistAndBroadcast(workspace);
  }

  async deleteMcpServer(serverId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.tooling.mcpServers = workspace.settings.tooling.mcpServers.filter(
      (server) => server.id !== serverId,
    );

    for (const session of workspace.sessions) {
      const selection = resolveSessionToolingSelection(session);
      session.tooling = {
        ...selection,
        enabledMcpServerIds: selection.enabledMcpServerIds.filter((id) => id !== serverId),
      };
    }

    await this.pruneUnavailableApprovalTools(workspace);
    return this.persistAndBroadcast(workspace);
  }

  async saveLspProfile(profile: LspProfileDefinition): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const existingIndex = workspace.settings.tooling.lspProfiles.findIndex(
      (current) => current.id === profile.id,
    );
    const timestamp = nowIso();
    const candidate = normalizeLspProfileDefinition({
      ...profile,
      createdAt:
        existingIndex >= 0
          ? workspace.settings.tooling.lspProfiles[existingIndex].createdAt
          : timestamp,
      updatedAt: timestamp,
    });
    const issue = validateLspProfileDefinition(candidate);
    if (issue) {
      throw new Error(issue);
    }

    if (existingIndex >= 0) {
      workspace.settings.tooling.lspProfiles[existingIndex] = candidate;
    } else {
      workspace.settings.tooling.lspProfiles.push(candidate);
    }

    await this.pruneUnavailableApprovalTools(workspace);
    return this.persistAndBroadcast(workspace);
  }

  async deleteLspProfile(profileId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.tooling.lspProfiles = workspace.settings.tooling.lspProfiles.filter(
      (profile) => profile.id !== profileId,
    );

    for (const session of workspace.sessions) {
      const selection = resolveSessionToolingSelection(session);
      session.tooling = {
        ...selection,
        enabledLspProfileIds: selection.enabledLspProfileIds.filter((id) => id !== profileId),
      };
    }

    await this.pruneUnavailableApprovalTools(workspace);
    return this.persistAndBroadcast(workspace);
  }

  async saveWorkspaceAgent(agent: WorkspaceAgentDefinition): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const agents = workspace.settings.agents ?? [];
    const existingIndex = agents.findIndex((current) => current.id === agent.id);
    const timestamp = nowIso();
    const candidate = normalizeWorkspaceAgentDefinition({
      ...agent,
      createdAt: existingIndex >= 0 ? agents[existingIndex].createdAt : timestamp,
      updatedAt: timestamp,
    });

    if (!candidate.name) {
      throw new Error('Workspace agent name is required.');
    }

    if (existingIndex >= 0) {
      agents[existingIndex] = candidate;
    } else {
      agents.push(candidate);
    }

    workspace.settings.agents = agents;
    return this.persistAndBroadcast(workspace);
  }

  async deleteWorkspaceAgent(agentId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.agents = (workspace.settings.agents ?? []).filter(
      (agent) => agent.id !== agentId,
    );
    return this.persistAndBroadcast(workspace);
  }

  async createSession(projectId: string, workflowId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    const workflow = this.requireWorkflow(workspace, workflowId);
    const modelCatalog = await this.loadAvailableModelCatalog();
    const executionWorkflow = normalizeWorkflowModels(
      this.buildResolvedExecutionWorkflow(workspace, workflow),
      modelCatalog,
    );

    const session: SessionRecord = {
      id: createId('session'),
      projectId: project.id,
      workflowId: workflow.id,
      title: workflow.name,
      titleSource: 'auto',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'idle',
      messages: [],
      sessionModelConfig: createSessionModelConfig(
        executionWorkflow,
        this.createWorkflowResolutionOptions(workspace),
      ),
      tooling: createSessionToolingSelection(),
      runs: [],
    };

    await this.ensureScratchpadSessionDirectory(session);
    workspace.sessions.unshift(session);
    workspace.selectedProjectId = project.id;
    workspace.selectedWorkflowId = workflow.id;
    workspace.selectedSessionId = session.id;
    return this.persistAndBroadcast(workspace);
  }

  async createWorkflowSession(projectId: string, workflowId: string): Promise<WorkspaceState> {
    return this.createSession(projectId, workflowId);
  }

  async duplicateSession(sessionId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const duplicate = duplicateSessionRecord(session, createId('session'), nowIso());
    if (isScratchpadProject(duplicate.projectId)) {
      duplicate.cwd = undefined;
    }

    await this.ensureScratchpadSessionDirectory(duplicate);
    workspace.sessions.unshift(duplicate);
    workspace.selectedProjectId = duplicate.projectId;
    workspace.selectedWorkflowId = duplicate.workflowId;
    workspace.selectedSessionId = duplicate.id;
    return this.persistAndBroadcast(workspace);
  }

  async branchSession(sessionId: string, messageId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const workflow = this.requireWorkflow(workspace, session.workflowId);
    const branch = branchSessionRecord(session, workflow, createId('session'), messageId, nowIso());
    if (isScratchpadProject(branch.projectId)) {
      branch.cwd = undefined;
    }

    await this.ensureScratchpadSessionDirectory(branch);
    workspace.sessions.unshift(branch);
    workspace.selectedProjectId = branch.projectId;
    workspace.selectedWorkflowId = branch.workflowId;
    workspace.selectedSessionId = branch.id;
    return this.persistAndBroadcast(workspace);
  }

  async setSessionMessagePinned(sessionId: string, messageId: string, isPinned: boolean): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const updated = setSessionMessagePinnedRecord(session, messageId, isPinned, nowIso());

    Object.assign(session, updated);
    return this.persistAndBroadcast(workspace);
  }

  async renameSession(sessionId: string, title: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const renamed = renameSessionRecord(session, title, nowIso());

    Object.assign(session, renamed);
    return this.persistAndBroadcast(workspace);
  }

  async setSessionPinned(sessionId: string, isPinned: boolean): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    session.isPinned = isPinned;
    session.updatedAt = nowIso();
    return this.persistAndBroadcast(workspace);
  }

  async setSessionArchived(sessionId: string, isArchived: boolean): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    session.isArchived = isArchived;
    session.updatedAt = nowIso();
    return this.persistAndBroadcast(workspace);
  }

  async deleteSession(sessionId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const sessionIndex = workspace.sessions.findIndex((s) => s.id === sessionId);
    if (sessionIndex < 0) {
      throw new Error(`Session ${sessionId} not found.`);
    }

    const session = workspace.sessions[sessionIndex];
    if (!session) {
      throw new Error(`Session ${sessionId} not found.`);
    }

    const scratchpadDirectory = this.resolveScratchpadSessionDirectory(session);
    if (scratchpadDirectory) {
      await rm(scratchpadDirectory, { recursive: true, force: true });
    }

    workspace.sessions.splice(sessionIndex, 1);

    if (workspace.selectedSessionId === sessionId) {
      workspace.selectedSessionId = workspace.sessions[0]?.id;
    }

    // Clean up corresponding Copilot SDK session data
    try {
      await this.sidecar.deleteSession(sessionId);
    } catch {
      // Best-effort — don't fail the deletion if SDK cleanup fails
    }

    return this.persistAndBroadcast(workspace);
  }

  async regenerateSessionMessage(sessionId: string, messageId: string): Promise<void> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    if (session.status === 'running') {
      throw new Error('Wait for the current response or approval checkpoint to finish before regenerating a message.');
    }

    const project = this.requireProject(workspace, session.projectId);
    const workflow = this.resolveSessionWorkflow(workspace, session);
    const effectiveWorkflow = this.applyProjectCustomizationToWorkflow(
      await this.buildEffectiveWorkflow(workflow, session, workspace.settings.agents ?? []),
      project,
    );
    const projectInstructions = resolveProjectInstructionsContent(project.customization);
    const occurredAt = nowIso();
    const regeneratedSession = regenerateSessionRecord(
      session,
      effectiveWorkflow,
      createId('session'),
      messageId,
      occurredAt,
    );
    if (isScratchpadProject(regeneratedSession.projectId)) {
      regeneratedSession.cwd = undefined;
    }

    await this.ensureScratchpadSessionDirectory(regeneratedSession);
    workspace.sessions.unshift(regeneratedSession);
    workspace.selectedProjectId = regeneratedSession.projectId;
    workspace.selectedWorkflowId = regeneratedSession.workflowId;
    workspace.selectedSessionId = regeneratedSession.id;

    const triggerMessage = regeneratedSession.messages.at(-1);
    if (!triggerMessage || triggerMessage.role !== 'user') {
      throw new Error('Regenerated session is missing the user message needed to replay the turn.');
    }

    await this.runPreparedSessionTurn(
      workspace,
      regeneratedSession,
      project,
      effectiveWorkflow,
      projectInstructions,
      {
        occurredAt,
        requestId: createId('turn'),
        triggerMessageId: triggerMessage.id,
      },
    );
  }

  async editAndResendSessionMessage(
    sessionId: string,
    messageId: string,
    content: string,
    attachments?: ChatMessageAttachment[],
  ): Promise<void> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    if (session.status === 'running') {
      throw new Error('Wait for the current response or approval checkpoint to finish before editing and resending a message.');
    }

    const sourceMessage = session.messages.find((message) => message.id === messageId);
    if (!sourceMessage) {
      throw new Error(`Message ${messageId} not found in session ${session.id}.`);
    }

    const preparedContent = prepareChatMessageContent(content);
    if (!preparedContent) {
      throw new Error('Message content is required.');
    }

    const project = this.requireProject(workspace, session.projectId);
    const workflow = this.resolveSessionWorkflow(workspace, session);
    const effectiveWorkflow = this.applyProjectCustomizationToWorkflow(
      await this.buildEffectiveWorkflow(workflow, session, workspace.settings.agents ?? []),
      project,
    );
    const projectInstructions = resolveProjectInstructionsContent(project.customization);
    const occurredAt = nowIso();
    const nextAttachments = attachments === undefined ? sourceMessage.attachments : attachments;
    const editedSession = editAndResendSessionRecord(
      session,
      effectiveWorkflow,
      createId('session'),
      messageId,
      preparedContent,
      occurredAt,
      nextAttachments,
    );
    if (isScratchpadProject(editedSession.projectId)) {
      editedSession.cwd = undefined;
    }

    await this.ensureScratchpadSessionDirectory(editedSession);
    workspace.sessions.unshift(editedSession);
    workspace.selectedProjectId = editedSession.projectId;
    workspace.selectedWorkflowId = editedSession.workflowId;
    workspace.selectedSessionId = editedSession.id;

    const triggerMessage = editedSession.messages.at(-1);
    if (!triggerMessage || triggerMessage.role !== 'user') {
      throw new Error('Edited session is missing the user message needed to replay the turn.');
    }

    await this.runPreparedSessionTurn(
      workspace,
      editedSession,
      project,
      effectiveWorkflow,
      projectInstructions,
      {
        occurredAt,
        requestId: createId('turn'),
        triggerMessageId: triggerMessage.id,
      },
    );
  }

  async sendSessionMessage(
    sessionId: string,
    content: string,
    attachments?: ChatMessageAttachment[],
    messageMode?: MessageMode,
    promptInvocation?: ProjectPromptInvocation,
  ): Promise<void> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);

    // Steering/queueing: allow messages during an active turn when messageMode is set
    if (session.status === 'running' && !messageMode) {
      throw new Error('Wait for the current response or approval checkpoint to finish before sending another message.');
    }
    const project = this.requireProject(workspace, session.projectId);
    const workflow = this.resolveSessionWorkflow(workspace, session);
    const effectiveWorkflow = this.applyProjectCustomizationToWorkflow(
      await this.buildEffectiveWorkflow(workflow, session, workspace.settings.agents ?? []),
      project,
    );
    const projectInstructions = resolveProjectInstructionsContent(project.customization);

    const normalizedPromptInvocation = hydratePromptInvocationMetadata(
      normalizeProjectPromptInvocation(promptInvocation),
      project.customization,
    );
    const preparedContent = prepareChatMessageContent(content)
      ?? buildPromptInvocationFallbackContent(normalizedPromptInvocation);
    if (!preparedContent) {
      return;
    }

    const requestId = createId('turn');
    const occurredAt = nowIso();
    const userMessageId = createId('msg');
    session.messages.push({
      id: userMessageId,
      role: 'user',
      authorName: 'You',
      content: preparedContent,
      createdAt: occurredAt,
      attachments: attachments?.length ? attachments : undefined,
      promptInvocation: normalizedPromptInvocation,
    });
    await this.runPreparedSessionTurn(
      workspace,
      session,
      project,
      effectiveWorkflow,
      projectInstructions,
      {
        occurredAt,
        requestId,
        triggerMessageId: userMessageId,
        messageMode,
        attachments,
      },
    );
  }

  async cancelSessionTurn(sessionId: string): Promise<void> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    if (session.status !== 'running') {
      return;
    }

    const runningRun = session.runs.find((run) => run.status === 'running');
    if (!runningRun) {
      return;
    }

    await this.sidecar.cancelTurn(runningRun.requestId);
  }

  async resolveSessionApproval(
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
    alwaysApprove?: boolean,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    return this.approvalCoordinator.resolveSessionApproval(
      workspace,
      session.id,
      approvalId,
      decision,
      alwaysApprove,
    );
  }

  async resolveSessionUserInput(
    sessionId: string,
    userInputId: string,
    answer: string,
    wasFreeform: boolean,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    return this.approvalCoordinator.resolveSessionUserInput(
      workspace,
      sessionId,
      userInputId,
      answer,
      wasFreeform,
    );
  }

  async updateSessionModelConfig(
    sessionId: string,
    model: string,
    reasoningEffort?: ReasoningEffort,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const project = this.requireProject(workspace, session.projectId);
    const modelCatalog = await this.loadAvailableModelCatalog();
    const workflow = normalizeWorkflowModels(
      this.buildResolvedExecutionWorkflow(workspace, this.requireWorkflow(workspace, session.workflowId)),
      modelCatalog,
    );
    const agentNodes = resolveWorkflowAgentNodes(workflow);

    if (agentNodes.length !== 1) {
      throw new Error('Model override is only supported for single-agent sessions.');
    }

    if (session.status === 'running') {
      throw new Error('Wait for the current response to finish before changing model settings.');
    }

    const normalizedModel = model.trim();
    const selectedModel = normalizedModel ? findModel(normalizedModel, modelCatalog) : undefined;
    if (!selectedModel) {
      throw new Error(`Model "${model}" is not available.`);
    }
    if (reasoningEffort && !isReasoningEffort(reasoningEffort)) {
      throw new Error(`Reasoning effort "${reasoningEffort}" is not supported.`);
    }

    session.sessionModelConfig = {
      model: normalizedModel,
      reasoningEffort: resolveReasoningEffort(selectedModel, reasoningEffort),
    };
    session.updatedAt = nowIso();

    return this.persistAndBroadcast(workspace);
  }

  async setSessionInteractionMode(
    sessionId: string,
    mode: 'interactive' | 'plan',
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);

    session.interactionMode = mode === 'interactive' ? undefined : mode;
    session.updatedAt = nowIso();

    return this.persistAndBroadcast(workspace);
  }

  async dismissSessionPlanReview(sessionId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);

    session.pendingPlanReview = undefined;
    session.updatedAt = nowIso();

    return this.persistAndBroadcast(workspace);
  }

  async dismissSessionMcpAuth(sessionId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);

    session.pendingMcpAuth = undefined;
    session.updatedAt = nowIso();

    return this.persistAndBroadcast(workspace);
  }

  async startSessionMcpAuth(sessionId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);

    if (!session.pendingMcpAuth) {
      return workspace;
    }

    session.pendingMcpAuth.status = 'authenticating';
    session.updatedAt = nowIso();
    await this.persistAndBroadcast(workspace);

    const result = await performMcpOAuthFlow({
      serverUrl: session.pendingMcpAuth.serverUrl,
      staticClientConfig: session.pendingMcpAuth.staticClientConfig,
    });

    const workspaceAfter = await this.loadWorkspace();
    const sessionAfter = this.requireSession(workspaceAfter, sessionId);

    if (!sessionAfter.pendingMcpAuth) {
      return workspaceAfter;
    }

    if (result.success) {
      sessionAfter.pendingMcpAuth.status = 'authenticated';
      sessionAfter.pendingMcpAuth.completedAt = nowIso();

      // Re-probe the server now that we have a token
      void this.reprobeServerByUrl(session.pendingMcpAuth.serverUrl).catch((error) => {
        console.error('[aryx mcp-probe] re-probe after auth failed:', error);
      });
    } else {
      sessionAfter.pendingMcpAuth.status = 'failed';
      sessionAfter.pendingMcpAuth.errorMessage = result.error ?? 'Authentication failed';
    }

    sessionAfter.updatedAt = nowIso();
    return this.persistAndBroadcast(workspaceAfter);
  }

  /**
   * Proactively probes newly-enabled HTTP MCP servers for OAuth requirements.
   * If a server returns 401 and has discoverable OAuth metadata, automatically
   * triggers the OAuth flow (opens browser for consent) without user interaction.
   */
  private async probeAndAuthenticateHttpMcpServers(
    sessionId: string,
    tooling: WorkspaceToolingSettings,
    selection: SessionToolingSelection,
  ): Promise<void> {
    void sessionId;
    await this.mcpProbeManager.probeAndAuthenticateHttpMcpServers(tooling, selection);
  }

  private async runPreparedSessionTurn(
    workspace: WorkspaceState,
    session: SessionRecord,
    project: ProjectRecord,
    effectiveWorkflow: WorkflowDefinition,
    projectInstructions: string | undefined,
    options: {
      occurredAt: string;
      requestId: string;
      triggerMessageId: string;
      messageMode?: MessageMode;
      attachments?: ChatMessageAttachment[];
    },
  ): Promise<void> {
    await this.sessionTurnExecutor.runPreparedSessionTurn(
      workspace,
      session,
      project,
      effectiveWorkflow,
      projectInstructions,
      options,
    );
  }

  async updateSessionTooling(
    sessionId: string,
    enabledMcpServerIds: string[],
    enabledLspProfileIds: string[],
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const project = this.requireProject(workspace, session.projectId);

    if (session.status === 'running') {
      throw new Error('Wait for the current response to finish before changing session tools.');
    }

    const selection = normalizeSessionToolingSelection({
      enabledMcpServerIds,
      enabledLspProfileIds,
    });
    validateSessionToolingSelectionIds(
      resolveProjectToolingSettings(workspace.settings, project.discoveredTooling),
      selection,
    );

    const previousEnabledMcpServerIds = new Set(session.tooling?.enabledMcpServerIds ?? []);
    session.tooling = selection;
    session.updatedAt = nowIso();
    const result = await this.persistAndBroadcast(workspace);

    // Proactively authenticate only newly enabled HTTP MCP servers
    const newlyEnabledIds = selection.enabledMcpServerIds.filter((id) => !previousEnabledMcpServerIds.has(id));
    if (newlyEnabledIds.length > 0) {
      const selectionForNewServers = normalizeSessionToolingSelection({
        enabledMcpServerIds: newlyEnabledIds,
        enabledLspProfileIds: [],
      });
      void this.probeAndAuthenticateHttpMcpServers(
        sessionId,
        resolveProjectToolingSettings(workspace.settings, project.discoveredTooling),
        selectionForNewServers,
      );
    }

    return result;
  }

  async updateSessionApprovalSettings(
    sessionId: string,
    autoApprovedToolNames?: string[],
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const project = this.requireProject(workspace, session.projectId);

    if (session.status === 'running') {
      throw new Error('Wait for the current response to finish before changing session approval settings.');
    }

    const settings = normalizeSessionApprovalSettings(
      autoApprovedToolNames === undefined ? undefined : { autoApprovedToolNames },
    );

    const knownToolNames = new Set(await this.listKnownApprovalToolNames(workspace, project));
    const unknownToolName = settings?.autoApprovedToolNames.find((toolName) => !knownToolNames.has(toolName));
    if (unknownToolName) {
      throw new Error(`Unknown approval tool "${unknownToolName}".`);
    }

    session.approvalSettings = settings;
    session.updatedAt = nowIso();
    return this.persistAndBroadcast(workspace);
  }

  async querySessions(input: QuerySessionsInput): Promise<SessionQueryResult[]> {
    const workspace = await this.loadWorkspace();
    return queryWorkspaceSessions(workspace, input);
  }

  async getQuota(): Promise<Record<string, import('@shared/contracts/sidecar').QuotaSnapshot>> {
    return this.sidecar.getQuota();
  }

  async refreshProjectGitContext(projectId?: string): Promise<WorkspaceState> {
    return this.gitContextManager.refreshProjectGitContext(projectId);
  }

  async getProjectGitDetails(projectId: string, commitLimit = 20): Promise<ProjectGitDetails> {
    return this.gitContextManager.getProjectGitDetails(projectId, commitLimit);
  }

  async getProjectGitFilePreview(
    projectId: string,
    file: ProjectGitFileReference,
  ): Promise<ProjectGitDiffPreview | undefined> {
    return this.gitContextManager.getProjectGitFilePreview(projectId, file);
  }

  async discardSessionRunGitChanges(
    sessionId: string,
    runId: string,
    files?: ProjectGitFileReference[],
  ): Promise<WorkspaceState> {
    return this.gitContextManager.discardSessionRunGitChanges(sessionId, runId, files);
  }

  async stageProjectGitFiles(projectId: string, files: ProjectGitFileReference[]): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.stageFiles(project.path, files);
    });
  }

  async unstageProjectGitFiles(projectId: string, files: ProjectGitFileReference[]): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.unstageFiles(project.path, files);
    });
  }

  async suggestProjectGitCommitMessage(
    sessionId: string,
    runId?: string,
    conventionalType?: ProjectGitCommitMessageSuggestion['type'],
  ): Promise<ProjectGitCommitMessageSuggestion> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const run = runId
      ? this.requireSessionRun(session, runId)
      : session.runs[0];
    if (!run) {
      throw new Error('This session does not have a run to summarize into a commit message.');
    }

    return buildProjectGitCommitMessageSuggestion({
      session,
      run,
      summary: run.postRunGitSummary,
      conventionalType,
    });
  }

  async commitProjectGitChanges(
    projectId: string,
    message: string,
    files?: ProjectGitFileReference[],
    push = false,
  ): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      if (files && files.length > 0) {
        await this.gitService.stageFiles(project.path, files);
      }

      await this.gitService.commit(project.path, message);
      if (push) {
        await this.gitService.push(project.path);
      }
    });
  }

  async pushProjectGit(projectId: string): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.push(project.path);
    });
  }

  async fetchProjectGit(projectId: string): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.fetch(project.path);
    });
  }

  async pullProjectGit(projectId: string, rebase = false): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.pull(project.path, rebase);
    });
  }

  async createProjectGitBranch(
    projectId: string,
    name: string,
    startPoint?: string,
    checkout = true,
  ): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.createBranch(project.path, name, startPoint, checkout);
    });
  }

  async switchProjectGitBranch(projectId: string, name: string): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.switchBranch(project.path, name);
    });
  }

  async deleteProjectGitBranch(projectId: string, name: string, force = false): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, async (project) => {
      await this.gitService.deleteBranch(project.path, name, force);
    });
  }

  private async refreshProjectGitContexts(projectIds?: readonly string[]): Promise<WorkspaceState> {
    return this.gitContextManager.refreshProjectGitContexts(projectIds);
  }

  async selectProject(projectId?: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    if (projectId) {
      const project = this.requireProject(workspace, projectId);
      const didSyncProjectTooling = await this.syncProjectDiscoveredTooling(workspace, project);
      await this.syncProjectCustomization(project);
      if (didSyncProjectTooling) {
        this.pruneUnavailableSessionToolingSelections(workspace);
        await this.pruneUnavailableApprovalTools(workspace);
      }
    }

    workspace.selectedProjectId = projectId;
    workspace.selectedSessionId = workspace.selectedSessionId;
    return this.persistAndBroadcast(workspace);
  }

  async selectSession(sessionId?: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    if (sessionId) {
      const session = this.requireSession(workspace, sessionId);
      const project = this.requireProject(workspace, session.projectId);
      const didSyncProjectTooling = await this.syncProjectDiscoveredTooling(workspace, project);
      await this.syncProjectCustomization(project);
      if (didSyncProjectTooling) {
        this.pruneUnavailableSessionToolingSelections(workspace);
        await this.pruneUnavailableApprovalTools(workspace);
      }

      workspace.selectedProjectId = session.projectId;
    }

    workspace.selectedSessionId = sessionId;
    return this.persistAndBroadcast(workspace);
  }

  private requireProject(workspace: WorkspaceState, projectId: string): ProjectRecord {
    const project = workspace.projects.find((current) => current.id === projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" was not found.`);
    }

    return project;
  }

  private requireSessionRun(session: SessionRecord, runId: string): SessionRunRecord {
    const run = session.runs.find((candidate) => candidate.id === runId);
    if (!run) {
      throw new Error(`Run "${runId}" was not found for session "${session.id}".`);
    }

    return run;
  }

  private resolveRunWorkingDirectory(
    session: SessionRecord,
    project: ProjectRecord,
    run: SessionRunRecord,
  ): string {
    return this.gitContextManager.resolveRunWorkingDirectory(session, project, run);
  }

  private async refreshSessionRunGitSummary(
    session: SessionRecord,
    project: ProjectRecord,
    requestId: string,
    occurredAt: string,
  ): Promise<SessionRunRecord | undefined> {
    return this.gitContextManager.refreshSessionRunGitSummary(session, project, requestId, occurredAt);
  }

  private async runProjectGitMutation(
    projectId: string,
    mutation: (project: ProjectRecord) => Promise<void>,
  ): Promise<WorkspaceState> {
    return this.gitContextManager.runProjectGitMutation(projectId, mutation);
  }

  private resolveTerminalWorkingDirectory(workspace: WorkspaceState): string {
    const selectedSession = workspace.selectedSessionId
      ? workspace.sessions.find((session) => session.id === workspace.selectedSessionId)
      : undefined;
    if (selectedSession) {
      const project = this.requireProject(workspace, selectedSession.projectId);
      return selectedSession.cwd ?? project.path;
    }

    const selectedProject = workspace.selectedProjectId
      ? workspace.projects.find((project) => project.id === workspace.selectedProjectId)
      : workspace.projects[0];
    if (!selectedProject) {
      throw new Error('Open a project or session before starting the integrated terminal.');
    }

    return selectedProject.path;
  }

  private async refreshGitContextForProject(project: ProjectRecord): Promise<boolean> {
    const beforeGit = JSON.stringify(project.git);
    await this.gitContextManager.refreshProjectGitContext(project.id);
    return JSON.stringify(project.git) !== beforeGit;
  }

  private startPeriodicProjectGitRefresh(): void {
    this.gitContextManager.startPeriodicProjectGitRefresh();
  }

  private stopPeriodicProjectGitRefresh(): void {
    this.gitContextManager.stopPeriodicProjectGitRefresh();
  }

  private async flushScheduledProjectGitRefresh(): Promise<void> {
    await this.gitContextManager.flushScheduledProjectGitRefresh();
  }

  private requireWorkflowTemplate(workspace: WorkspaceState, templateId: string): WorkflowTemplateDefinition {
    return this.workflowManager.requireWorkflowTemplate(workspace, templateId);
  }

  private requireWorkflow(workspace: WorkspaceState, workflowId: string): WorkflowDefinition {
    return this.workflowManager.requireWorkflow(workspace, workflowId);
  }

  private createUniqueWorkflowId(workspace: WorkspaceState, sourceId: string): string {
    return this.workflowManager.createUniqueWorkflowId(workspace, sourceId);
  }

  private normalizeIdentifier(value: string, fallbackPrefix: string): string {
    return this.workflowManager.normalizeIdentifier(value, fallbackPrefix);
  }

  private resolveSessionWorkflow(
    workspace: WorkspaceState,
    session: SessionRecord,
  ): WorkflowDefinition {
    return this.workflowManager.resolveSessionWorkflow(workspace, session);
  }

  private buildResolvedExecutionWorkflow(
    workspace: WorkspaceState,
    workflow: WorkflowDefinition,
  ): WorkflowDefinition {
    return this.workflowManager.buildResolvedExecutionWorkflow(workspace, workflow);
  }

  private createWorkflowResolutionOptions(workspace: WorkspaceState) {
    return this.workflowManager.createWorkflowResolutionOptions(workspace);
  }

  private validateWorkflowReferences(
    workspace: WorkspaceState,
    workflow: WorkflowDefinition,
  ): void {
    this.workflowManager.validateWorkflowReferences(workspace, workflow);
  }

  private listWorkflowReferencesInWorkspace(
    workspace: WorkspaceState,
    workflowId: string,
  ): WorkflowReference[] {
    return this.workflowManager.listWorkflowReferencesInWorkspace(workspace, workflowId);
  }

  private requireSession(workspace: WorkspaceState, sessionId: string): SessionRecord {
    const session = workspace.sessions.find((current) => current.id === sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" was not found.`);
    }

    return session;
  }

  private resolveScratchpadSessionDirectory(
    session: Pick<SessionRecord, 'id' | 'projectId' | 'cwd'>,
  ): string | undefined {
    if (!isScratchpadProject(session.projectId)) {
      return undefined;
    }

    return session.cwd ?? getScratchpadSessionPath(session.id);
  }

  private async ensureScratchpadSessionDirectory(session: SessionRecord): Promise<void> {
    const scratchpadDirectory = this.resolveScratchpadSessionDirectory(session);
    if (!scratchpadDirectory) {
      return;
    }

    await mkdir(scratchpadDirectory, { recursive: true });
    session.cwd = scratchpadDirectory;
  }

  private async applyTurnDelta(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    event: TurnDeltaEvent,
  ): Promise<void> {
    if (event.content === undefined && event.contentDelta === undefined) {
      return;
    }

    const occurredAt = nowIso();
    const session = this.requireSession(workspace, sessionId);
    const existing = session.messages.find((message) => message.id === event.messageId);
    const content =
      existing && event.content === undefined
        ? mergeStreamingText(existing.content, event.contentDelta)
        : (event.content ?? event.contentDelta);

    // When a new assistant message begins, auto-complete any previously pending
    // assistant messages so only the latest one shows the "Thinking" indicator.
    const completedMessages: ChatMessageRecord[] = [];
    if (existing) {
      existing.content = content;
      existing.pending = true;
      existing.authorName = event.authorName;
    } else {
      for (const message of session.messages) {
        if (message.pending && message.role === 'assistant') {
          message.pending = false;
          completedMessages.push(message);
        }
      }
      session.messages.push({
        id: event.messageId,
        role: 'assistant',
        authorName: event.authorName,
        content,
        createdAt: occurredAt,
        pending: true,
      });
    }

    const nextRun = this.updateSessionRun(session, requestId, (run) =>
      upsertRunMessageEvent(run, {
        messageId: event.messageId,
        occurredAt,
        authorName: event.authorName,
        content,
        status: 'running',
      }));

    session.updatedAt = occurredAt;
    await this.workspaceRepository.save(workspace);

    for (const completed of completedMessages) {
      this.emitSessionEvent({
        sessionId,
        kind: 'message-complete',
        occurredAt,
        messageId: completed.id,
        authorName: completed.authorName,
        content: completed.content,
      });
    }
    this.emitSessionEvent({
      sessionId,
      kind: 'message-delta',
      occurredAt,
      messageId: event.messageId,
      authorName: event.authorName,
      contentDelta: event.contentDelta,
      content: event.content,
    });
    if (nextRun) {
      this.emitRunUpdated(sessionId, occurredAt, nextRun);
    }
  }

  private async applyMessageReclassified(
    workspace: WorkspaceState,
    sessionId: string,
    event: MessageReclassifiedEvent,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const message = session.messages.find((m) => m.id === event.messageId);
    if (!message || message.messageKind === 'thinking') {
      return;
    }

    message.messageKind = 'thinking';
    const occurredAt = nowIso();
    session.updatedAt = occurredAt;
    await this.workspaceRepository.save(workspace);

    this.emitSessionEvent({
      sessionId,
      kind: 'message-reclassified',
      occurredAt,
      messageId: event.messageId,
      messageKind: 'thinking',
    });
  }

  private async applyAgentActivity(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    event: AgentActivityEvent,
  ): Promise<void> {
    const occurredAt = nowIso();
    const session = this.requireSession(workspace, sessionId);
    const activityType = event.activityType;
    let nextRun: SessionRunRecord | undefined;
    if (activityType !== 'completed') {
      nextRun = this.updateSessionRun(session, requestId, (run) =>
        appendRunActivityEvent(run, {
          activityType,
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          sourceAgentId: event.sourceAgentId,
          sourceAgentName: event.sourceAgentName,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          toolArguments: event.toolArguments,
          fileChanges: event.fileChanges,
        }));
    }
    if (nextRun) {
      session.updatedAt = occurredAt;
      await this.workspaceRepository.save(workspace);
      this.emitRunUpdated(sessionId, occurredAt, nextRun);
    }

    this.emitSessionEvent({
      sessionId,
      kind: 'agent-activity',
      occurredAt,
      activityType: event.activityType,
      agentId: event.agentId,
      agentName: event.agentName,
      sourceAgentId: event.sourceAgentId,
      sourceAgentName: event.sourceAgentName,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      toolArguments: event.toolArguments,
      fileChanges: event.fileChanges,
    });
  }

  private emitCompletedActivity(
    sessionId: string,
    workflow: WorkflowDefinition,
    message: ChatMessageRecord,
  ): void {
    if (message.role !== 'assistant') {
      return;
    }

    const agentNode = resolveWorkflowAgentNodes(workflow)
      .find((candidate) =>
        candidate.config.kind === 'agent'
        && (candidate.config.id === message.authorName || candidate.config.name === message.authorName))
      ;
    const agent = agentNode?.config.kind === 'agent' ? agentNode.config : undefined;
    if (!agent) {
      return;
    }

    this.emitSessionEvent({
      sessionId,
      kind: 'agent-activity',
      occurredAt: nowIso(),
      activityType: 'completed',
      agentId: agent.id,
      agentName: agent.name,
    });
  }

  private finalizeTurn(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    messages: ChatMessageRecord[],
  ): void {
    const session = this.requireSession(workspace, sessionId);
    const workflow = this.resolveSessionWorkflow(workspace, session);
    const incomingIds = new Set(messages.map((message) => message.id));

    // Messages that were streamed during the turn already exist in session.messages
    // (possibly with messageKind: 'thinking' from reclassification). Unstreamed messages
    // (e.g. from sub-agents) only appear now. Classify them as thinking when a visible
    // response was already streamed, since they are intermediate tool-driving steps.
    const existingIds = new Set(session.messages.map((m) => m.id));
    const hasVisibleResponse = session.messages.some(
      (m) => m.role === 'assistant' && m.messageKind !== 'thinking',
    );

    for (const message of messages) {
      const occurredAt = nowIso();
      const existing = session.messages.find((current) => current.id === message.id);
      if (existing) {
        existing.authorName = message.authorName;
        existing.content = message.content;
        existing.pending = false;
      } else {
        const isUnstreamedIntermediate =
          message.role === 'assistant'
          && hasVisibleResponse
          && !message.messageKind;
        session.messages.push({
          ...message,
          pending: false,
          messageKind: message.messageKind ?? (isUnstreamedIntermediate ? 'thinking' : undefined),
        });
      }

      const reclassifiedAsThinking =
        !existingIds.has(message.id)
        && (message.messageKind === 'thinking'
          || (message.role === 'assistant' && hasVisibleResponse && !message.messageKind));

      const nextRun = this.updateSessionRun(session, requestId, (run) =>
        upsertRunMessageEvent(run, {
          messageId: message.id,
          occurredAt,
          authorName: message.authorName,
          content: message.content,
          status: 'completed',
        }));
      this.emitSessionEvent({
        sessionId,
        kind: 'message-complete',
        occurredAt,
        messageId: message.id,
        authorName: message.authorName,
        content: message.content,
      });
      if (reclassifiedAsThinking) {
        this.emitSessionEvent({
          sessionId,
          kind: 'message-reclassified',
          occurredAt,
          messageId: message.id,
          messageKind: 'thinking',
        });
      }
      if (nextRun) {
        this.emitRunUpdated(sessionId, occurredAt, nextRun);
      }

        this.emitCompletedActivity(sessionId, workflow, message);
    }

    for (const message of session.messages) {
      if (message.pending && incomingIds.has(message.id)) {
        message.pending = false;
      }
    }

    const completedAt = nowIso();
    session.status = 'idle';
    session.lastError = undefined;
    session.pendingUserInput = undefined;
    session.pendingPlanReview = undefined;
    session.pendingMcpAuth = undefined;
    session.updatedAt = completedAt;
    const completedRun = this.updateSessionRun(session, requestId, (run) =>
      completeSessionRunRecord(run, completedAt));
    this.emitSessionEvent({
      sessionId,
      kind: 'status',
      occurredAt: completedAt,
      status: 'idle',
    });
    if (completedRun) {
      this.emitRunUpdated(sessionId, completedAt, completedRun);
    }
  }

  private finalizeCancelledTurn(
    workspace: WorkspaceState,
    session: SessionRecord,
    requestId: string,
  ): void {
    for (const message of session.messages) {
      if (message.pending) {
        message.pending = false;
      }
    }

    this.rejectPendingApprovals(session, nowIso(), 'The turn was cancelled.');

    const cancelledAt = nowIso();
    session.status = 'idle';
    session.lastError = undefined;
    session.pendingUserInput = undefined;
    session.pendingPlanReview = undefined;
    session.pendingMcpAuth = undefined;
    session.updatedAt = cancelledAt;
    const cancelledRun = this.updateSessionRun(session, requestId, (run) =>
      cancelSessionRunRecord(run, cancelledAt));
    this.emitSessionEvent({
      sessionId: session.id,
      kind: 'status',
      occurredAt: cancelledAt,
      status: 'idle',
    });
    if (cancelledRun) {
      this.emitRunUpdated(session.id, cancelledAt, cancelledRun);
    }
  }

  private async handleApprovalRequested(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    approval: ApprovalRequestedEvent | PendingApprovalRecord,
    resolve: (decision: ApprovalDecision, alwaysApprove?: boolean) => void | Promise<void>,
  ): Promise<void> {
    await this.approvalCoordinator.handleApprovalRequested(workspace, sessionId, requestId, approval, resolve);
  }

  private async handleUserInputRequested(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    event: UserInputRequestedEvent,
    resolve: (answer: string, wasFreeform: boolean) => void | Promise<void>,
  ): Promise<void> {
    await this.approvalCoordinator.handleUserInputRequested(workspace, sessionId, requestId, event, resolve);
  }

  private async handleExitPlanModeRequested(
    workspace: WorkspaceState,
    sessionId: string,
    event: ExitPlanModeRequestedEvent,
  ): Promise<void> {
    await this.approvalCoordinator.handleExitPlanModeRequested(workspace, sessionId, event);
  }

  private async handleMcpOAuthRequired(
    workspace: WorkspaceState,
    sessionId: string,
    event: McpOauthRequiredEvent,
  ): Promise<void> {
    await this.approvalCoordinator.handleMcpOAuthRequired(workspace, sessionId, event);
  }

  private handleTurnScopedEvent(
    workspace: WorkspaceState,
    sessionId: string,
    event: TurnScopedEvent,
  ): void {
    const occurredAt = nowIso();

    switch (event.type) {
      case 'workflow-checkpoint-saved': {
        const session = this.requireSession(workspace, sessionId);
        const run = session.runs.find((candidate) => candidate.requestId === event.requestId);
        if (run) {
          this.recordWorkflowCheckpointRecovery(session, run, event);
        }

        return;
      }
      case 'subagent-event':
        this.emitSessionEvent({
          sessionId,
          kind: 'subagent',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          subagentEventKind: event.eventKind,
          customAgentName: event.customAgentName,
          customAgentDisplayName: event.customAgentDisplayName,
          customAgentDescription: event.customAgentDescription,
          subagentError: event.error,
          subagentToolCallId: event.toolCallId,
          subagentModel: event.model,
        });
        return;
      case 'skill-invoked':
        this.emitSessionEvent({
          sessionId,
          kind: 'skill-invoked',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          skillName: event.skillName,
          skillPath: event.path,
          pluginName: event.pluginName,
        });
        return;
      case 'hook-lifecycle':
        this.emitSessionEvent({
          sessionId,
          kind: 'hook-lifecycle',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          hookInvocationId: event.hookInvocationId,
          hookType: event.hookType,
          hookPhase: event.phase,
          hookSuccess: event.success,
        });
        return;
      case 'session-usage':
        this.emitSessionEvent({
          sessionId,
          kind: 'session-usage',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          tokenLimit: event.tokenLimit,
          currentTokens: event.currentTokens,
          messagesLength: event.messagesLength,
        });
        return;
      case 'session-compaction':
        this.emitSessionEvent({
          sessionId,
          kind: 'session-compaction',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          compactionPhase: event.phase,
          compactionSuccess: event.success,
          preCompactionTokens: event.preCompactionTokens,
          postCompactionTokens: event.postCompactionTokens,
          tokensRemoved: event.tokensRemoved,
        });
        return;
      case 'pending-messages-modified':
        this.emitSessionEvent({
          sessionId,
          kind: 'pending-messages-modified',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
        });
        return;
      case 'workflow-diagnostic':
        this.emitSessionEvent({
          sessionId,
          kind: 'workflow-diagnostic',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          diagnosticSeverity: event.severity,
          diagnosticKind: event.diagnosticKind,
          diagnosticMessage: event.message,
          executorId: event.executorId,
          subworkflowId: event.subworkflowId,
          exceptionType: event.exceptionType,
        });
        return;
      case 'assistant-usage':
        this.emitSessionEvent({
          sessionId,
          kind: 'assistant-usage',
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          usageModel: event.model,
          usageInputTokens: event.inputTokens,
          usageOutputTokens: event.outputTokens,
          usageCacheReadTokens: event.cacheReadTokens,
          usageCacheWriteTokens: event.cacheWriteTokens,
          usageCost: event.cost,
          usageDuration: event.duration,
          usageTotalNanoAiu: event.totalNanoAiu,
          usageQuotaSnapshots: event.quotaSnapshots,
        });
        return;
    }
  }

  private async runSidecarTurnWithCheckpointRecovery(
    workspace: WorkspaceState,
    session: SessionRecord,
    requestId: string,
    createCommand: (resumeFromCheckpoint?: WorkflowCheckpointResume) => RunTurnCommand,
    onDelta: (event: TurnDeltaEvent) => void | Promise<void>,
    onActivity: (event: AgentActivityEvent) => void | Promise<void>,
    onApproval: (event: ApprovalRequestedEvent) => void | Promise<void>,
    onUserInput: (event: UserInputRequestedEvent) => void | Promise<void>,
    onMcpOAuthRequired: (event: McpOauthRequiredEvent) => void | Promise<void>,
    onExitPlanMode: (event: ExitPlanModeRequestedEvent) => void | Promise<void>,
    onMessageReclassified: (event: MessageReclassifiedEvent) => void | Promise<void>,
    onTurnScopedEvent: (event: TurnScopedEvent) => void | Promise<void>,
  ): Promise<ChatMessageRecord[]> {
    return this.checkpointRecoveryManager.runSidecarTurnWithCheckpointRecovery(
      workspace,
      session,
      requestId,
      (resumeFromCheckpoint?: WorkflowCheckpointResume) => this.sidecar.runTurn(
        createCommand(resumeFromCheckpoint),
        onDelta,
        onActivity,
        onApproval,
        onUserInput,
        onMcpOAuthRequired,
        onExitPlanMode,
        onMessageReclassified,
        onTurnScopedEvent,
      ),
      isUnexpectedSidecarTerminationError,
    );
  }

  private recordWorkflowCheckpointRecovery(
    session: SessionRecord,
    run: SessionRunRecord,
    event: WorkflowCheckpointSavedEvent,
  ): void {
    this.checkpointRecoveryManager.recordWorkflowCheckpointRecovery(session, run, event);
  }

  private restoreWorkflowCheckpointRecovery(
    session: SessionRecord,
    requestId: string,
    recovery: WorkflowCheckpointRecoveryState,
  ): SessionRunRecord | undefined {
    return this.checkpointRecoveryManager.restoreWorkflowCheckpointRecovery(session, requestId, recovery);
  }

  private clearPendingRunState(session: SessionRecord, requestId: string): void {
    this.checkpointRecoveryManager.clearPendingRunState(session, requestId);
  }

  private async cleanupWorkflowCheckpointRecovery(requestId: string): Promise<void> {
    await this.checkpointRecoveryManager.cleanupWorkflowCheckpointRecovery(requestId);
  }

  private createPendingApprovalFromSidecarEvent(event: ApprovalRequestedEvent): PendingApprovalRecord {
    return this.approvalCoordinator.createPendingApprovalFromSidecarEvent(event);
  }

  private setSessionPendingApprovalState(
    session: SessionRecord,
    state: {
      pendingApproval?: PendingApprovalRecord;
      pendingApprovalQueue?: PendingApprovalRecord[];
    },
  ): void {
    this.approvalCoordinator.setSessionPendingApprovalState(session, state);
  }

  private rejectPendingApprovals(
    session: SessionRecord,
    failedAt: string,
    error: string,
  ): string[] {
    return this.approvalCoordinator.rejectPendingApprovals(session, failedAt, error);
  }

  private async awaitFinalResponseApproval(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    workflow: WorkflowDefinition,
    messages: ChatMessageRecord[],
  ): Promise<void> {
    const pendingApproval = this.buildFinalResponseApproval(workflow, messages);
    if (!pendingApproval) {
      return;
    }

    let resolveDecision: ((decision: ApprovalDecision) => void) | undefined;
    const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
      resolveDecision = resolve;
    });

    await this.handleApprovalRequested(
      workspace,
      sessionId,
      requestId,
      pendingApproval,
      (decision) => {
        resolveDecision?.(decision);
      },
    );

    const decision = await decisionPromise;
    if (decision === 'rejected') {
      throw new Error('Final response approval was rejected.');
    }
  }

  private buildFinalResponseApproval(
    workflow: WorkflowDefinition,
    messages: ChatMessageRecord[],
  ): PendingApprovalRecord | undefined {
    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    if (assistantMessages.length === 0) {
      return undefined;
    }

    const previewMessages: PendingApprovalMessageRecord[] = assistantMessages.map((message) => ({
      id: message.id,
      authorName: message.authorName,
      content: message.content,
    }));

    for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
      const message = assistantMessages[index];
      if (!message) {
        continue;
      }

      const agentNode = resolveWorkflowAgentNodes(workflow)
        .find((candidate) =>
          candidate.config.kind === 'agent'
          && (candidate.config.id === message.authorName || candidate.config.name === message.authorName))
        ;
      const agent = agentNode?.config.kind === 'agent' ? agentNode.config : undefined;
      if (!approvalPolicyRequiresCheckpoint(workflow.settings.approvalPolicy, 'final-response', agent?.id)) {
        continue;
      }

      const agentName = agent?.name ?? message.authorName;
      return {
        id: createId('approval'),
        kind: 'final-response',
        status: 'pending',
        requestedAt: nowIso(),
        agentId: agent?.id,
        agentName,
        title: agentName ? `Approve final response from ${agentName}` : 'Approve final response',
        detail: 'Review the pending assistant response before it is added to the session transcript.',
        messages: previewMessages,
      };
    }

    return undefined;
  }

  private async persistAndBroadcast(workspace: WorkspaceState): Promise<WorkspaceState> {
    await this.workspaceRepository.save(workspace);
    this.emit('workspace-updated', workspace);
    return workspace;
  }

  private async loadAvailableModelCatalog() {
    try {
      const capabilities = await this.describeSidecarCapabilities();
      return buildAvailableModelCatalog(capabilities.models);
    } catch {
      return buildAvailableModelCatalog();
    }
  }

  private async buildEffectiveWorkflow(
    workflow: WorkflowDefinition,
    session: SessionRecord,
    workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>,
  ): Promise<WorkflowDefinition> {
    return this.sessionTurnExecutor.buildEffectiveWorkflow(workflow, session, workspaceAgents);
  }

  private async applyPromptInvocationToWorkflow(
    workflow: WorkflowDefinition,
    promptInvocation?: ProjectPromptInvocation,
  ): Promise<WorkflowDefinition> {
    return this.sessionTurnExecutor.applyPromptInvocationToWorkflow(workflow, promptInvocation);
  }

  private applyProjectCustomizationToWorkflow(
    workflow: WorkflowDefinition,
    project: ProjectRecord,
  ): WorkflowDefinition {
    return this.sessionTurnExecutor.applyProjectCustomizationToWorkflow(workflow, project);
  }

  private buildProjectCustomAgents(
    customization?: ProjectCustomizationState,
  ): RunTurnCustomAgentConfig[] {
    return this.sessionTurnExecutor.buildProjectCustomAgents(customization);
  }

  private mapProjectAgentProfile(profile: ProjectAgentProfile): RunTurnCustomAgentConfig {
    return this.sessionTurnExecutor.mapProjectAgentProfile(profile);
  }

  private async listKnownApprovalToolNames(
    workspace: WorkspaceState,
    project?: ProjectRecord,
  ): Promise<string[]> {
    const capabilities = await this.loadSidecarCapabilities();
    const runtimeTools = capabilities.runtimeTools.length > 0 ? capabilities.runtimeTools : undefined;
    const tooling = project
      ? resolveProjectToolingSettings(workspace.settings, project.discoveredTooling)
      : resolveWorkspaceToolingSettings(workspace.settings);
    return listApprovalToolNames(tooling, runtimeTools);
  }

  private async pruneUnavailableApprovalTools(workspace: WorkspaceState): Promise<boolean> {
    const capabilities = await this.loadSidecarCapabilities();
    const runtimeTools = capabilities.runtimeTools.length > 0 ? capabilities.runtimeTools : undefined;
    const workspaceKnownToolNames = listApprovalToolNames(
      resolveWorkspaceToolingSettings(workspace.settings),
      runtimeTools,
    );
    let changed = false;

    for (const workflow of workspace.workflows) {
      const nextPolicy = pruneApprovalPolicyTools(workflow.settings.approvalPolicy, workspaceKnownToolNames);
      if (!equalStringArrays(
        workflow.settings.approvalPolicy?.autoApprovedToolNames,
        nextPolicy?.autoApprovedToolNames,
      )) {
        workflow.settings.approvalPolicy = nextPolicy;
        changed = true;
      }
    }

    for (const session of workspace.sessions) {
      const project = this.requireProject(workspace, session.projectId);
      const knownToolNames = listApprovalToolNames(
        resolveProjectToolingSettings(workspace.settings, project.discoveredTooling),
        runtimeTools,
      );
      const nextSettings = pruneSessionApprovalSettings(
        session.approvalSettings,
        knownToolNames,
      );
      if (!equalStringArrays(
        session.approvalSettings?.autoApprovedToolNames,
        nextSettings?.autoApprovedToolNames,
      )) {
        session.approvalSettings = nextSettings;
        changed = true;
      }
    }

    return changed;
  }

  private buildRunTurnToolingConfig(
    workspace: WorkspaceState,
    session: SessionRecord,
  ): RunTurnToolingConfig | undefined {
    const project = this.requireProject(workspace, session.projectId);
    const tooling = resolveProjectToolingSettings(workspace.settings, project.discoveredTooling);
    const selection = resolveSessionToolingSelection(session);
    validateSessionToolingSelectionIds(tooling, selection);
    return buildSessionToolingConfig(tooling, selection, (serverUrl) => {
      const token = getStoredToken(serverUrl);
      return token?.accessToken;
    });
  }

  private async syncUserDiscoveredTooling(workspace: WorkspaceState): Promise<boolean> {
    return this.discoveredToolingSyncService.syncUserDiscoveredTooling(workspace);
  }

  private async syncProjectCustomizationWatchers(workspace: WorkspaceState): Promise<void> {
    await this.discoveredToolingSyncService.syncProjectCustomizationWatchers(workspace);
  }

  private resolveRunTurnPromptInvocation(
    session: SessionRecord,
    triggerMessageId: string,
  ): ProjectPromptInvocation | undefined {
    return this.sessionTurnExecutor.resolveRunTurnPromptInvocation(session, triggerMessageId);
  }

  private async handleProjectCustomizationWatcherChange(projectId: string): Promise<void> {
    await this.discoveredToolingSyncService.handleProjectCustomizationWatcherChange(projectId);
  }

  private enqueueCustomizationWatcherUpdate(task: () => Promise<void>): Promise<void> {
    return task();
  }

  private async syncProjectCustomization(project: ProjectRecord): Promise<boolean> {
    return this.discoveredToolingSyncService.syncProjectCustomization(project);
  }

  private async syncProjectDiscoveredTooling(
    workspace: WorkspaceState,
    project: ProjectRecord,
  ): Promise<boolean> {
    return this.discoveredToolingSyncService.syncProjectDiscoveredTooling(workspace, project);
  }

  private async probeAllAcceptedMcpServers(workspace: WorkspaceState): Promise<void> {
    await this.mcpProbeManager.probeAllAcceptedMcpServers(workspace);
  }

  private async probeDiscoveredMcpServersFromState(
    workspace: WorkspaceState,
    state?: DiscoveredToolingState,
  ): Promise<void> {
    await this.mcpProbeManager.probeDiscoveredMcpServersFromState(workspace, state);
  }

  private async probeDiscoveredMcpServers(
    workspace: WorkspaceState,
    state: DiscoveredToolingState | undefined,
    serverIds: ReadonlyArray<string>,
  ): Promise<void> {
    await this.mcpProbeManager.probeDiscoveredMcpServers(workspace, state, serverIds);
  }

  private async probeWorkspaceMcpServers(
    workspace: WorkspaceState,
    targets: ReadonlyArray<McpServerDefinition>,
  ): Promise<void> {
    await this.mcpProbeManager.probeWorkspaceMcpServers(workspace, targets);
  }

  /**
   * Re-probes all MCP servers matching a given URL after OAuth authentication
   * succeeds, so their tools appear in the approval pill without restart.
   */
  private async reprobeServerByUrl(serverUrl: string): Promise<void> {
    await this.mcpProbeManager.reprobeServerByUrl(serverUrl);
  }

  private listAcceptedDiscoveredServerDefinitions(
    workspace: WorkspaceState,
    predicate?: (server: DiscoveredMcpServer) => boolean,
  ): McpServerDefinition[] {
    return this.mcpProbeManager.listAcceptedDiscoveredServerDefinitions(workspace, predicate);
  }

  private listDiscoveredToolingStates(workspace: WorkspaceState): Array<DiscoveredToolingState | undefined> {
    return this.mcpProbeManager.listDiscoveredToolingStates(workspace);
  }

  private addMcpProbingServerIds(workspace: WorkspaceState, serverIds: ReadonlyArray<string>): boolean {
    return this.mcpProbeManager.addMcpProbingServerIds(workspace, serverIds);
  }

  private removeMcpProbingServerIds(workspace: WorkspaceState, serverIds: ReadonlyArray<string>): boolean {
    return this.mcpProbeManager.removeMcpProbingServerIds(workspace, serverIds);
  }

  private updateMcpProbingServerIds(
    workspace: WorkspaceState,
    serverIds: ReadonlyArray<string>,
    operation: 'add' | 'remove',
  ): boolean {
    return this.mcpProbeManager.updateMcpProbingServerIds(workspace, serverIds, operation);
  }

  private applyMcpProbeResult(workspace: WorkspaceState, result: McpProbeResult): boolean {
    return this.mcpProbeManager.applyMcpProbeResult(workspace, result);
  }

  private async enqueueMcpProbeUpdate(update: () => Promise<void>): Promise<void> {
    await update();
  }

  private discoveredServerToDefinition(server: DiscoveredMcpServer): McpServerDefinition {
    return this.mcpProbeManager.discoveredServerToDefinition(server);
  }

  private pruneUnavailableSessionToolingSelections(workspace: WorkspaceState): boolean {
    let changed = false;

    for (const session of workspace.sessions) {
      const project = this.requireProject(workspace, session.projectId);
      const effectiveTooling = resolveProjectToolingSettings(workspace.settings, project.discoveredTooling);
      const knownMcpServerIds = new Set(effectiveTooling.mcpServers.map((server) => server.id));
      const knownLspProfileIds = new Set(effectiveTooling.lspProfiles.map((profile) => profile.id));
      const selection = resolveSessionToolingSelection(session);
      const nextSelection = normalizeSessionToolingSelection({
        enabledMcpServerIds: selection.enabledMcpServerIds.filter((id) => knownMcpServerIds.has(id)),
        enabledLspProfileIds: selection.enabledLspProfileIds.filter((id) => knownLspProfileIds.has(id)),
      });

      if (
        equalStringArrays(selection.enabledMcpServerIds, nextSelection.enabledMcpServerIds)
        && equalStringArrays(selection.enabledLspProfileIds, nextSelection.enabledLspProfileIds)
      ) {
        continue;
      }

      session.tooling = nextSelection;
      changed = true;
    }

    return changed;
  }

  private resolveDiscoveredToolingStatus(
    resolution: DiscoveredToolingResolution,
  ): Exclude<DiscoveredToolingStatus, 'pending'> {
    return this.discoveredToolingSyncService.resolveDiscoveredToolingStatus(resolution);
  }

  private equalDiscoveredToolingState(
    left?: DiscoveredToolingState,
    right?: DiscoveredToolingState,
  ): boolean {
    return this.discoveredToolingSyncService.equalDiscoveredToolingState(left, right);
  }

  private equalProjectCustomizationState(
    left?: ProjectCustomizationState,
    right?: ProjectCustomizationState,
  ): boolean {
    return this.discoveredToolingSyncService.equalProjectCustomizationState(left, right);
  }

  private updateSessionRun(
    session: SessionRecord,
    requestId: string,
    updater: (run: SessionRunRecord) => SessionRunRecord,
  ): SessionRunRecord | undefined {
    const run = session.runs.find((candidate) => candidate.requestId === requestId);
    if (!run) {
      return undefined;
    }

    const nextRun = updater(run);
    if (nextRun === run) {
      return undefined;
    }

    session.runs = upsertSessionRunRecord(session.runs, nextRun);
    return nextRun;
  }

  private emitRunUpdated(sessionId: string, occurredAt: string, run: SessionRunRecord): void {
    this.emitSessionEvent({
      sessionId,
      kind: 'run-updated',
      occurredAt,
      run,
    });
  }

  private emitSessionEvent(event: SessionEventRecord): void {
    this.emit('session-event', event);
  }

  private cleanupInterruptedSessions(workspace: WorkspaceState): boolean {
    let changed = false;

    for (const session of workspace.sessions) {
      const pendingApprovals = listPendingApprovals(session);
      const hasPendingUserInput = session.pendingUserInput !== undefined;
      const failedRequestIds = new Set(
        session.runs
          .filter((run) => run.status === 'running')
          .map((run) => run.requestId),
      );
      if (pendingApprovals.length === 0 && !hasPendingUserInput && failedRequestIds.size === 0) {
        continue;
      }

      changed = true;
      const failedAt = nowIso();
      if (pendingApprovals.length > 0) {
        for (const requestId of this.rejectPendingApprovals(session, failedAt, INTERRUPTED_APPROVAL_ERROR)) {
          failedRequestIds.add(requestId);
        }
      }

      if (session.pendingUserInput) {
        this.approvalCoordinator.pendingUserInputHandles.delete(session.pendingUserInput.id);
        session.pendingUserInput = undefined;
      }

      session.status = 'error';
      session.lastError = INTERRUPTED_RUN_ERROR;
      session.updatedAt = failedAt;

      for (const requestId of failedRequestIds) {
        this.updateSessionRun(session, requestId, (run) =>
          failSessionRunRecord(run, failedAt, INTERRUPTED_RUN_ERROR));
      }
    }

    return changed;
  }

  private findApprovalRequestId(session: SessionRecord, approvalId: string): string | undefined {
    return this.approvalCoordinator.findApprovalRequestId(session, approvalId);
  }

  private async loadSidecarCapabilities(forceRefresh = false): Promise<SidecarCapabilities> {
    if (forceRefresh) {
      this.sidecarCapabilities = undefined;
      this.sidecarCapabilitiesPromise = undefined;
    }

    if (this.sidecarCapabilities) {
      return this.sidecarCapabilities;
    }

    if (!this.sidecarCapabilitiesPromise) {
      let request!: Promise<SidecarCapabilities>;
      request = (async () => {
        try {
          const capabilities = await this.fetchSidecarCapabilities();
          this.sidecarCapabilities = capabilities;
          return capabilities;
        } finally {
          if (this.sidecarCapabilitiesPromise === request) {
            this.sidecarCapabilitiesPromise = undefined;
          }
        }
      })();
      this.sidecarCapabilitiesPromise = request;
    }

    return this.sidecarCapabilitiesPromise;
  }

  private async fetchSidecarCapabilities(): Promise<SidecarCapabilities> {
    try {
      return await this.sidecar.describeCapabilities();
    } catch (error) {
      if (!isSidecarStoppedBeforeCompletionError(error)) {
        throw error;
      }
    }

    return this.sidecar.describeCapabilities();
  }
}
