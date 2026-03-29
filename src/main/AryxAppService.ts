import { EventEmitter } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import electron from 'electron';

import type {
  AgentActivityEvent,
  ApprovalRequestedEvent,
  ExitPlanModeRequestedEvent,
  McpOauthRequiredEvent,
  RunTurnCustomAgentConfig,
  RunTurnToolingConfig,
  SidecarCapabilities,
  TurnDeltaEvent,
  UserInputRequestedEvent,
} from '@shared/contracts/sidecar';
import type { TurnScopedEvent } from '@main/sidecar/runTurnPending';
import {
  buildAvailableModelCatalog,
  findModel,
  normalizePatternModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import {
  isReasoningEffort,
  syncPatternGraph,
  type PatternDefinition,
  type ReasoningEffort,
  validatePatternDefinition,
} from '@shared/domain/pattern';
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
  normalizeProjectCustomizationState,
  resolveProjectInstructionsContent,
  setProjectAgentProfileEnabled,
  type ProjectAgentProfile,
  type ProjectCustomizationState,
} from '@shared/domain/projectCustomization';
import {
  approvalPolicyRequiresCheckpoint,
  dequeuePendingApprovalState,
  enqueuePendingApprovalState,
  listPendingApprovals,
  normalizeApprovalPolicy,
  normalizeSessionApprovalSettings,
  pruneApprovalPolicyTools,
  pruneSessionApprovalSettings,
  resolveApprovalToolKey,
  resolvePendingApproval,
  type ApprovalDecision,
  type PendingApprovalMessageRecord,
  type PendingApprovalRecord,
} from '@shared/domain/approval';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import {
  duplicateSessionRecord,
  querySessions as queryWorkspaceSessions,
  renameSessionRecord,
  type QuerySessionsInput,
  type SessionQueryResult,
} from '@shared/domain/sessionLibrary';
import type { SessionEventRecord } from '@shared/domain/event';
import type { TerminalExitInfo, TerminalSnapshot } from '@shared/domain/terminal';
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
  upsertRunApprovalEvent,
  upsertRunMessageEvent,
  upsertSessionRunRecord,
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
import {
  SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE,
  SidecarClient,
} from '@main/sidecar/sidecarProcess';
import { TurnCancelledError } from '@main/sidecar/turnCancelledError';
import { GitService } from '@main/git/gitService';
import {
  buildRunTurnToolingConfig as buildSessionToolingConfig,
  validateSessionToolingSelectionIds,
} from '@main/sessionToolingConfig';
import { getStoredToken } from '@main/services/mcpTokenStore';
import { performMcpOAuthFlow, requiresOAuth } from '@main/services/mcpOAuthService';
import { probeServers, type McpProbeResult } from '@main/services/mcpToolProber';
import { PtyManager } from '@main/services/ptyManager';

const { dialog, shell } = electron;

type AppServiceEvents = {
  'workspace-updated': [WorkspaceState];
  'session-event': [SessionEventRecord];
  'terminal-data': [string];
  'terminal-exit': [TerminalExitInfo];
};

type PendingApprovalHandle = {
  sessionId: string;
  requestId: string;
  resolve: (decision: ApprovalDecision, alwaysApprove?: boolean) => void | Promise<void>;
};

type PendingUserInputHandle = {
  sessionId: string;
  requestId: string;
  resolve: (answer: string, wasFreeform: boolean) => void | Promise<void>;
};

type DiscoveredToolingResolution = 'accept' | 'dismiss';

function isBuiltinPattern(patternId: string): boolean {
  return patternId.startsWith('pattern-');
}

function equalStringArrays(left?: readonly string[], right?: readonly string[]): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function isSidecarStoppedBeforeCompletionError(error: unknown): error is Error {
  return error instanceof Error && error.message === SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE;
}

const INTERRUPTED_RUN_ERROR =
  'This session was interrupted because Aryx restarted while a run was in progress.';
const INTERRUPTED_APPROVAL_ERROR =
  'Pending approval was interrupted because Aryx restarted before a decision was recorded.';

export class AryxAppService extends EventEmitter<AppServiceEvents> {
  private readonly workspaceRepository = new WorkspaceRepository();
  private readonly sidecar = new SidecarClient();
  private readonly secretStore = new SecretStore();
  private readonly gitService = new GitService();
  private readonly configScanner = new ConfigScannerRegistry();
  private readonly customizationScanner = new ProjectCustomizationScanner();
  private readonly probeMcpServers = probeServers;
  private readonly ptyManager = new PtyManager();
  private readonly pendingApprovalHandles = new Map<string, PendingApprovalHandle>();
  private readonly pendingUserInputHandles = new Map<string, PendingUserInputHandle>();
  private workspace?: WorkspaceState;
  private sidecarCapabilities?: SidecarCapabilities;
  private sidecarCapabilitiesPromise?: Promise<SidecarCapabilities>;
  private didScheduleInitialProjectGitRefresh = false;
  private mcpProbeUpdateQueue = Promise.resolve();

  constructor() {
    super();

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
      const didSyncUserTooling = await this.syncUserDiscoveredTooling(this.workspace);
      const didSyncProjectTooling = selectedProject
        ? await this.syncProjectDiscoveredTooling(this.workspace, selectedProject)
        : false;
      const didSyncProjectCustomization = selectedProject
        ? await this.syncProjectCustomization(selectedProject)
        : false;
      const didPruneSelections = this.pruneUnavailableSessionToolingSelections(this.workspace);
      const didPruneApprovalTools = await this.pruneUnavailableApprovalTools(this.workspace);
      if (
        didSyncUserTooling
        || didSyncProjectTooling
        || didSyncProjectCustomization
        || didPruneSelections
        || didPruneApprovalTools
        || this.cleanupInterruptedSessions(this.workspace)
      ) {
        await this.workspaceRepository.save(this.workspace);
      }
    }

    if (!this.didScheduleInitialProjectGitRefresh) {
      this.didScheduleInitialProjectGitRefresh = true;
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
    this.ptyManager.dispose();
    await this.sidecar.dispose();
    void this.secretStore;
  }

  async openAppDataFolder(): Promise<void> {
    const appDataPath = dirname(this.workspaceRepository.filePath);
    await shell.openPath(appDataPath);
  }

  async resetLocalWorkspace(): Promise<WorkspaceState> {
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

    return this.persistAndBroadcast(workspace);
  }

  async resolveWorkspaceDiscoveredTooling(
    serverIds: string[],
    resolution: DiscoveredToolingResolution,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.settings.discoveredUserTooling = applyDiscoveredMcpServerStatus(
      workspace.settings.discoveredUserTooling,
      serverIds,
      this.resolveDiscoveredToolingStatus(resolution),
    );

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
    await this.syncProjectDiscoveredTooling(workspace, project);
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
    await this.syncProjectCustomization(project);
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
    project.discoveredTooling = applyDiscoveredMcpServerStatus(
      project.discoveredTooling,
      serverIds,
      this.resolveDiscoveredToolingStatus(resolution),
    );

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

  async savePattern(pattern: PatternDefinition): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const knownApprovalToolNames = await this.listKnownApprovalToolNames(workspace);
    const synchronizedPattern = pattern.graph ? pattern : syncPatternGraph(pattern);
    const issues = validatePatternDefinition(
      synchronizedPattern,
      knownApprovalToolNames,
    ).filter((issue) => issue.level === 'error');
    if (issues.length > 0) {
      throw new Error(issues[0].message);
    }

    const existingIndex = workspace.patterns.findIndex((current) => current.id === pattern.id);
    const candidate: PatternDefinition = {
      ...synchronizedPattern,
      approvalPolicy: normalizeApprovalPolicy(synchronizedPattern.approvalPolicy),
      isFavorite: pattern.isFavorite ?? workspace.patterns[existingIndex]?.isFavorite,
      createdAt: existingIndex >= 0 ? workspace.patterns[existingIndex].createdAt : nowIso(),
      updatedAt: nowIso(),
    };

    if (existingIndex >= 0) {
      workspace.patterns[existingIndex] = candidate;
    } else {
      workspace.patterns.push(candidate);
    }

    workspace.selectedPatternId = candidate.id;
    return this.persistAndBroadcast(workspace);
  }

  async setPatternFavorite(patternId: string, isFavorite: boolean): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const pattern = this.requirePattern(workspace, patternId);
    pattern.isFavorite = isFavorite;
    pattern.updatedAt = nowIso();
    return this.persistAndBroadcast(workspace);
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

  async deletePattern(patternId: string): Promise<WorkspaceState> {
    if (isBuiltinPattern(patternId)) {
      throw new Error('Built-in patterns cannot be deleted.');
    }

    const workspace = await this.loadWorkspace();
    workspace.patterns = workspace.patterns.filter((pattern) => pattern.id !== patternId);

    if (workspace.selectedPatternId === patternId) {
      workspace.selectedPatternId = workspace.patterns[0]?.id;
    }

    return this.persistAndBroadcast(workspace);
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

  async createSession(projectId: string, patternId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    const pattern = this.requirePattern(workspace, patternId);
    const modelCatalog = await this.loadAvailableModelCatalog();
    const normalizedPattern = normalizePatternModels(pattern, modelCatalog);

    const session: SessionRecord = {
      id: createId('session'),
      projectId: project.id,
      patternId: pattern.id,
      title: pattern.name,
      titleSource: 'auto',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'idle',
      messages: [],
      sessionModelConfig: normalizedPattern.agents.length === 1
        ? createSessionModelConfig(normalizedPattern)
        : undefined,
      tooling: createSessionToolingSelection(),
      runs: [],
    };

    await this.ensureScratchpadSessionDirectory(session);
    workspace.sessions.unshift(session);
    workspace.selectedProjectId = project.id;
    workspace.selectedPatternId = pattern.id;
    workspace.selectedSessionId = session.id;
    return this.persistAndBroadcast(workspace);
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
    workspace.selectedPatternId = duplicate.patternId;
    workspace.selectedSessionId = duplicate.id;
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

  async sendSessionMessage(
    sessionId: string,
    content: string,
    attachments?: import('@shared/domain/attachment').ChatMessageAttachment[],
    messageMode?: import('@shared/contracts/sidecar').MessageMode,
  ): Promise<void> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);

    // Steering/queueing: allow messages during an active turn when messageMode is set
    if (session.status === 'running' && !messageMode) {
      throw new Error('Wait for the current response or approval checkpoint to finish before sending another message.');
    }
    const project = this.requireProject(workspace, session.projectId);
    const pattern = this.requirePattern(workspace, session.patternId);
    const effectivePattern = this.applyProjectCustomizationToPattern(
      await this.buildEffectivePattern(pattern, session),
      project,
    );
    const projectInstructions = resolveProjectInstructionsContent(project.customization);

    const preparedContent = prepareChatMessageContent(content);
    if (!preparedContent) {
      return;
    }

    const requestId = createId('turn');
    const workspaceKind = isScratchpadProject(project) ? 'scratchpad' : 'project';
    const occurredAt = nowIso();
    const userMessageId = createId('msg');
    session.messages.push({
      id: userMessageId,
      role: 'user',
      authorName: 'You',
      content: preparedContent,
      createdAt: occurredAt,
      attachments: attachments?.length ? attachments : undefined,
    });
    session.title = resolveSessionTitle(session, effectivePattern, session.messages);
    session.status = 'running';
    session.lastError = undefined;
    session.pendingPlanReview = undefined;
    session.pendingMcpAuth = undefined;
    session.updatedAt = occurredAt;
    session.runs = [
      createSessionRunRecord({
        requestId,
        project,
        workspaceKind,
        pattern: effectivePattern,
        triggerMessageId: userMessageId,
        startedAt: occurredAt,
      }),
      ...session.runs,
    ];

    await this.persistAndBroadcast(workspace);
    this.emitSessionEvent({
      sessionId: session.id,
      kind: 'status',
      status: 'running',
      occurredAt,
    });

    try {
      const responseMessages = await this.sidecar.runTurn(
        {
          type: 'run-turn',
          requestId,
          sessionId: session.id,
          projectPath: session.cwd ?? project.path,
          workspaceKind,
          mode: session.interactionMode ?? 'interactive',
          messageMode,
          projectInstructions,
          pattern: effectivePattern,
          messages: session.messages,
          attachments: attachments?.length ? attachments : undefined,
          tooling: this.buildRunTurnToolingConfig(workspace, session),
        },
        async (event) => {
          await this.applyTurnDelta(workspace, session.id, requestId, event);
        },
        async (event) => {
          await this.applyAgentActivity(workspace, session.id, requestId, event);
        },
        async (event) => {
          await this.handleApprovalRequested(workspace, session.id, requestId, event, (decision, alwaysApprove) =>
            this.sidecar.resolveApproval(event.approvalId, decision, alwaysApprove));
        },
        async (event) => {
          await this.handleUserInputRequested(workspace, session.id, requestId, event, (answer, wasFreeform) =>
            this.sidecar.resolveUserInput(event.userInputId, answer, wasFreeform));
        },
        async (event) => {
          await this.handleMcpOAuthRequired(workspace, session.id, event);
        },
        async (event) => {
          await this.handleExitPlanModeRequested(workspace, session.id, event);
        },
        async (event) => {
          await this.handleTurnScopedEvent(workspace, session.id, event);
        },
      );

      await this.awaitFinalResponseApproval(workspace, session.id, requestId, effectivePattern, responseMessages);
      this.finalizeTurn(workspace, session.id, requestId, responseMessages);
      await this.persistAndBroadcast(workspace);
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        this.finalizeCancelledTurn(workspace, session, requestId);
        await this.persistAndBroadcast(workspace);
        return;
      }

      const failedAt = nowIso();
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = failedAt;

      const failedRun = this.updateSessionRun(session, requestId, (run) =>
        failSessionRunRecord(run, failedAt, session.lastError ?? 'Unknown error.'));

      this.emitSessionEvent({
        sessionId: session.id,
        kind: 'error',
        occurredAt: failedAt,
        error: session.lastError,
      });
      if (failedRun) {
        this.emitRunUpdated(session.id, failedAt, failedRun);
      }

      await this.persistAndBroadcast(workspace);
    }
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
    const approval = session.pendingApproval;
    if (!approval || approval.id !== approvalId) {
      const queuedApproval = session.pendingApprovalQueue?.some((candidate) => candidate.id === approvalId);
      if (queuedApproval) {
        throw new Error(
          approval
            ? `Approval "${approvalId}" is queued behind "${approval.id}" for session "${sessionId}". Resolve the active approval first.`
            : `Approval "${approvalId}" is queued but not active for session "${sessionId}".`,
        );
      }

      throw new Error(`Approval "${approvalId}" is not pending for session "${sessionId}".`);
    }

    const handle = this.pendingApprovalHandles.get(approvalId);
    if (!handle || handle.sessionId !== sessionId) {
      throw new Error(`Approval "${approvalId}" is no longer active. Restart the run and try again.`);
    }

    const resolvedAt = nowIso();
    const resolvedApproval = resolvePendingApproval(approval, decision, resolvedAt);
    this.setSessionPendingApprovalState(session, dequeuePendingApprovalState(session, approvalId));
    session.updatedAt = resolvedAt;

    const approvalKey = resolveApprovalToolKey(approval.toolName, approval.permissionKind);
    if (decision === 'approved' && alwaysApprove && approvalKey) {
      const existing = session.approvalSettings?.autoApprovedToolNames ?? [];
      if (!existing.includes(approvalKey)) {
        session.approvalSettings = { autoApprovedToolNames: [...existing, approvalKey] };
      }
    }

    const updatedRun = this.updateSessionRun(session, handle.requestId, (run) =>
      upsertRunApprovalEvent(run, resolvedApproval));

    // Auto-resolve queued approvals that share the same category key.
    // When the user approves "read", all pending view/grep/glob calls resolve too.
    const cascadeHandles: PendingApprovalHandle[] = [];
    if (decision === 'approved' && approvalKey && approval.kind === 'tool-call') {
      for (const queued of listPendingApprovals(session)) {
        if (queued.id === approvalId) continue;
        const queuedKey = resolveApprovalToolKey(queued.toolName, queued.permissionKind);
        if (queuedKey !== approvalKey) continue;

        const queuedHandle = this.pendingApprovalHandles.get(queued.id);
        if (!queuedHandle || queuedHandle.sessionId !== sessionId) continue;

        const cascadeResolved = resolvePendingApproval(queued, 'approved', resolvedAt);
        this.setSessionPendingApprovalState(session, dequeuePendingApprovalState(session, queued.id));
        this.updateSessionRun(session, queuedHandle.requestId, (run) =>
          upsertRunApprovalEvent(run, cascadeResolved));
        this.pendingApprovalHandles.delete(queued.id);
        cascadeHandles.push(queuedHandle);
      }
    }

    const result = await this.persistAndBroadcast(workspace);
    if (updatedRun) {
      this.emitRunUpdated(sessionId, resolvedAt, updatedRun);
    }

    this.pendingApprovalHandles.delete(approvalId);

    try {
      await Promise.resolve(handle.resolve(decision, alwaysApprove));
      for (const cascaded of cascadeHandles) {
        await Promise.resolve(cascaded.resolve('approved', alwaysApprove));
      }
    } catch (error) {
      const failedAt = nowIso();
      this.rejectPendingApprovals(
        session,
        failedAt,
        'Queued approval was cancelled because the run failed before it could resume.',
      );
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = failedAt;

      const failedRun = this.updateSessionRun(session, handle.requestId, (run) =>
        failSessionRunRecord(run, failedAt, session.lastError ?? 'Unknown error.'));

      this.emitSessionEvent({
        sessionId,
        kind: 'error',
        occurredAt: failedAt,
        error: session.lastError,
      });
      if (failedRun) {
        this.emitRunUpdated(sessionId, failedAt, failedRun);
      }

      await this.persistAndBroadcast(workspace);
      throw error;
    }

    return result;
  }

  async resolveSessionUserInput(
    sessionId: string,
    userInputId: string,
    answer: string,
    wasFreeform: boolean,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const pending = session.pendingUserInput;
    if (!pending || pending.id !== userInputId) {
      throw new Error(`User input "${userInputId}" is not pending for session "${sessionId}".`);
    }

    const handle = this.pendingUserInputHandles.get(userInputId);
    if (!handle || handle.sessionId !== sessionId) {
      throw new Error(`User input "${userInputId}" is no longer active. Restart the run and try again.`);
    }

    const answeredAt = nowIso();
    session.pendingUserInput = {
      ...pending,
      status: 'answered',
      answer,
      answeredAt,
    };
    session.updatedAt = answeredAt;

    const result = await this.persistAndBroadcast(workspace);
    this.pendingUserInputHandles.delete(userInputId);

    try {
      await Promise.resolve(handle.resolve(answer, wasFreeform));
      session.pendingUserInput = undefined;
      await this.persistAndBroadcast(workspace);
    } catch (error) {
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = nowIso();

      this.emitSessionEvent({
        sessionId,
        kind: 'error',
        occurredAt: session.updatedAt,
        error: session.lastError,
      });

      await this.persistAndBroadcast(workspace);
      throw error;
    }

    return result;
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
    const pattern = this.requirePattern(workspace, session.patternId);
    const effectivePattern = normalizePatternModels(pattern, modelCatalog);

    if (effectivePattern.agents.length !== 1) {
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
    const httpServers = selection.enabledMcpServerIds
      .map((id) => tooling.mcpServers.find((s) => s.id === id))
      .filter((s): s is McpServerDefinition => !!s && s.transport !== 'local')
      .filter((s) => s.transport === 'http' || s.transport === 'sse');

    if (httpServers.length === 0) {
      return;
    }

    console.log(`[aryx oauth] Probing ${httpServers.length} HTTP MCP server(s) for OAuth requirements…`);

    for (const server of httpServers) {
      if (server.transport === 'local') continue;
      const existingToken = getStoredToken(server.url);
      if (existingToken) {
        console.log(`[aryx oauth] Skipping ${server.name} — token already stored`);
        continue;
      }

      try {
        const needsAuth = await requiresOAuth(server.url);
        if (!needsAuth) {
          console.log(`[aryx oauth] ${server.name} does not require OAuth`);
          continue;
        }

        console.log(`[aryx oauth] ${server.name} requires OAuth — starting flow…`);
        const result = await performMcpOAuthFlow({ serverUrl: server.url });

        if (result.success) {
          console.log(`[aryx oauth] ${server.name} authenticated successfully`);
          void this.reprobeServerByUrl(server.url).catch((error) => {
            console.error('[aryx mcp-probe] re-probe after auth failed:', error);
          });
        } else {
          console.warn(`[aryx oauth] Proactive auth failed for ${server.name}: ${result.error}`);
        }
      } catch (err) {
        console.warn(`[aryx oauth] Proactive auth probe failed for ${server.name}:`, err);
      }
    }
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
    const workspace = await this.loadWorkspace();
    const projects = projectId
      ? [this.requireProject(workspace, projectId)]
      : workspace.projects;

    let didRefreshGit = false;
    let didSyncProjectTooling = false;
    let didSyncProjectCustomization = false;
    for (const project of projects) {
      didRefreshGit = await this.refreshGitContextForProject(project) || didRefreshGit;
      didSyncProjectTooling = await this.syncProjectDiscoveredTooling(workspace, project) || didSyncProjectTooling;
      didSyncProjectCustomization = await this.syncProjectCustomization(project) || didSyncProjectCustomization;
    }

    const didPruneSelections = didSyncProjectTooling
      ? this.pruneUnavailableSessionToolingSelections(workspace)
      : false;
    const didPruneApprovalTools = didSyncProjectTooling
      ? await this.pruneUnavailableApprovalTools(workspace)
      : false;

    return (
      didRefreshGit
      || didSyncProjectTooling
      || didSyncProjectCustomization
      || didPruneSelections
      || didPruneApprovalTools
    )
      ? this.persistAndBroadcast(workspace)
      : workspace;
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

  async selectPattern(patternId?: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    workspace.selectedPatternId = patternId;
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
    if (isScratchpadProject(project)) {
      if (!project.git) {
        return false;
      }

      project.git = undefined;
      return true;
    }

    project.git = await this.gitService.describeProject(project.path);
    return true;
  }

  private requirePattern(workspace: WorkspaceState, patternId: string): PatternDefinition {
    const pattern = workspace.patterns.find((current) => current.id === patternId);
    if (!pattern) {
      throw new Error(`Pattern "${patternId}" was not found.`);
    }

    return pattern;
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
    });
  }

  private emitCompletedActivity(
    sessionId: string,
    pattern: PatternDefinition,
    message: ChatMessageRecord,
  ): void {
    if (message.role !== 'assistant') {
      return;
    }

    const agent = pattern.agents.find((candidate) =>
      candidate.id === message.authorName || candidate.name === message.authorName);
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
    const pattern = this.requirePattern(workspace, session.patternId);
    const incomingIds = new Set(messages.map((message) => message.id));

    for (const message of messages) {
      const occurredAt = nowIso();
      const existing = session.messages.find((current) => current.id === message.id);
      if (existing) {
        existing.authorName = message.authorName;
        existing.content = message.content;
        existing.pending = false;
      } else {
        session.messages.push({ ...message, pending: false });
      }

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
      if (nextRun) {
        this.emitRunUpdated(sessionId, occurredAt, nextRun);
      }

      this.emitCompletedActivity(sessionId, pattern, message);
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
    const session = this.requireSession(workspace, sessionId);
    const pendingApproval =
      'type' in approval ? this.createPendingApprovalFromSidecarEvent(approval) : approval;

    this.setSessionPendingApprovalState(session, enqueuePendingApprovalState(session, pendingApproval));
    session.updatedAt = pendingApproval.requestedAt;

    const updatedRun = this.updateSessionRun(session, requestId, (run) =>
      upsertRunApprovalEvent(run, pendingApproval));

    this.pendingApprovalHandles.set(pendingApproval.id, {
      sessionId,
      requestId,
      resolve,
    });

    await this.persistAndBroadcast(workspace);
    if (updatedRun) {
      this.emitRunUpdated(sessionId, pendingApproval.requestedAt, updatedRun);
    }
  }

  private async handleUserInputRequested(
    workspace: WorkspaceState,
    sessionId: string,
    _requestId: string,
    event: UserInputRequestedEvent,
    resolve: (answer: string, wasFreeform: boolean) => void | Promise<void>,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const requestedAt = nowIso();

    session.pendingUserInput = {
      id: event.userInputId,
      status: 'pending',
      agentId: event.agentId,
      agentName: event.agentName,
      question: event.question,
      choices: event.choices,
      allowFreeform: event.allowFreeform ?? true,
      requestedAt,
    };
    session.updatedAt = requestedAt;

    this.pendingUserInputHandles.set(event.userInputId, {
      sessionId,
      requestId: _requestId,
      resolve,
    });

    await this.persistAndBroadcast(workspace);
  }

  private async handleExitPlanModeRequested(
    workspace: WorkspaceState,
    sessionId: string,
    event: ExitPlanModeRequestedEvent,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const requestedAt = nowIso();

    session.pendingPlanReview = {
      id: event.exitPlanId,
      status: 'pending',
      agentId: event.agentId,
      agentName: event.agentName,
      summary: event.summary,
      planContent: event.planContent,
      actions: event.actions,
      recommendedAction: event.recommendedAction,
      requestedAt,
    };
    session.updatedAt = requestedAt;

    await this.persistAndBroadcast(workspace);
  }

  private async handleMcpOAuthRequired(
    workspace: WorkspaceState,
    sessionId: string,
    event: McpOauthRequiredEvent,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const requestedAt = nowIso();

    session.pendingMcpAuth = {
      id: event.oauthRequestId,
      status: 'pending',
      agentId: event.agentId,
      agentName: event.agentName,
      serverName: event.serverName,
      serverUrl: event.serverUrl,
      staticClientConfig: event.staticClientConfig
        ? { clientId: event.staticClientConfig.clientId, publicClient: event.staticClientConfig.publicClient }
        : undefined,
      requestedAt,
    };
    session.updatedAt = requestedAt;

    await this.persistAndBroadcast(workspace);
  }

  private handleTurnScopedEvent(
    _workspace: WorkspaceState,
    sessionId: string,
    event: TurnScopedEvent,
  ): void {
    const occurredAt = nowIso();

    switch (event.type) {
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

  private createPendingApprovalFromSidecarEvent(event: ApprovalRequestedEvent): PendingApprovalRecord {
    return {
      id: event.approvalId,
      kind: event.approvalKind,
      status: 'pending',
      requestedAt: nowIso(),
      agentId: event.agentId,
      agentName: event.agentName,
      toolName: event.toolName,
      permissionKind: event.permissionKind,
      title: event.title,
      detail: event.detail,
      permissionDetail: event.permissionDetail,
    };
  }

  private setSessionPendingApprovalState(
    session: SessionRecord,
    state: {
      pendingApproval?: PendingApprovalRecord;
      pendingApprovalQueue?: PendingApprovalRecord[];
    },
  ): void {
    session.pendingApproval = state.pendingApproval;
    session.pendingApprovalQueue = state.pendingApprovalQueue;
  }

  private rejectPendingApprovals(
    session: SessionRecord,
    failedAt: string,
    error: string,
  ): string[] {
    const requestIds = new Set<string>();

    for (const pendingApproval of listPendingApprovals(session)) {
      const requestId = this.findApprovalRequestId(session, pendingApproval.id);
      const rejectedApproval = resolvePendingApproval(pendingApproval, 'rejected', failedAt, error);

      if (requestId) {
        requestIds.add(requestId);
        this.updateSessionRun(session, requestId, (run) =>
          upsertRunApprovalEvent(run, rejectedApproval));
      }

      this.pendingApprovalHandles.delete(pendingApproval.id);
    }

    this.setSessionPendingApprovalState(session, {});
    return [...requestIds];
  }

  private async awaitFinalResponseApproval(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    pattern: PatternDefinition,
    messages: ChatMessageRecord[],
  ): Promise<void> {
    const pendingApproval = this.buildFinalResponseApproval(pattern, messages);
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
    pattern: PatternDefinition,
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

      const agent = pattern.agents.find((candidate) =>
        candidate.id === message.authorName || candidate.name === message.authorName);
      if (!approvalPolicyRequiresCheckpoint(pattern.approvalPolicy, 'final-response', agent?.id)) {
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

  private async buildEffectivePattern(
    pattern: PatternDefinition,
    session: SessionRecord,
  ): Promise<PatternDefinition> {
    const patternWithSessionConfig = session.sessionModelConfig
      ? applySessionModelConfig(pattern, session)
      : pattern;
    const patternWithApprovalSettings = applySessionApprovalSettings(patternWithSessionConfig, session);

    const modelCatalog = await this.loadAvailableModelCatalog();
    return normalizePatternModels(patternWithApprovalSettings, modelCatalog);
  }

  private applyProjectCustomizationToPattern(
    pattern: PatternDefinition,
    project: ProjectRecord,
  ): PatternDefinition {
    if (isScratchpadProject(project)) {
      return pattern;
    }

    const projectCustomAgents = this.buildProjectCustomAgents(project.customization);
    if (projectCustomAgents.length === 0) {
      return pattern;
    }

    const [primaryAgent, ...remainingAgents] = pattern.agents;
    if (!primaryAgent) {
      return pattern;
    }

    const existingCustomAgents = primaryAgent.copilot?.customAgents ?? [];
    const existingAgentNames = new Set(existingCustomAgents.map((agent) => agent.name.toLowerCase()));
    const mergedCustomAgents = [
      ...existingCustomAgents,
      ...projectCustomAgents.filter((agent) => !existingAgentNames.has(agent.name.toLowerCase())),
    ];

    return {
      ...pattern,
      agents: [
        {
          ...primaryAgent,
          copilot: {
            ...primaryAgent.copilot,
            customAgents: mergedCustomAgents,
          },
        },
        ...remainingAgents,
      ],
    };
  }

  private buildProjectCustomAgents(
    customization?: ProjectCustomizationState,
  ): RunTurnCustomAgentConfig[] {
    return listEnabledProjectAgentProfiles(customization).map((profile) => this.mapProjectAgentProfile(profile));
  }

  private mapProjectAgentProfile(profile: ProjectAgentProfile): RunTurnCustomAgentConfig {
    const customAgent: RunTurnCustomAgentConfig = {
      name: profile.name,
      prompt: profile.prompt,
    };

    if (profile.displayName) {
      customAgent.displayName = profile.displayName;
    }

    if (profile.description) {
      customAgent.description = profile.description;
    }

    if (profile.tools) {
      customAgent.tools = profile.tools;
    }

    if (profile.infer !== undefined) {
      customAgent.infer = profile.infer;
    }

    return customAgent;
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

    for (const pattern of workspace.patterns) {
      const nextPolicy = pruneApprovalPolicyTools(pattern.approvalPolicy, workspaceKnownToolNames);
      if (!equalStringArrays(
        pattern.approvalPolicy?.autoApprovedToolNames,
        nextPolicy?.autoApprovedToolNames,
      )) {
        pattern.approvalPolicy = nextPolicy;
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
    const nextState = await this.configScanner.scanUser(workspace.settings.discoveredUserTooling);
    if (this.equalDiscoveredToolingState(workspace.settings.discoveredUserTooling, nextState)) {
      return false;
    }

    workspace.settings.discoveredUserTooling = nextState;
    return true;
  }

  private async syncProjectCustomization(project: ProjectRecord): Promise<boolean> {
    if (isScratchpadProject(project)) {
      if (!project.customization || this.equalProjectCustomizationState(project.customization, undefined)) {
        return false;
      }

      project.customization = undefined;
      return true;
    }

    const nextState = await this.customizationScanner.scanProject(project.path, project.customization);
    if (this.equalProjectCustomizationState(project.customization, nextState)) {
      return false;
    }

    project.customization = nextState;
    return true;
  }

  private async syncProjectDiscoveredTooling(
    workspace: WorkspaceState,
    project: ProjectRecord,
  ): Promise<boolean> {
    if (isScratchpadProject(project)) {
      if (!project.discoveredTooling || this.equalDiscoveredToolingState(project.discoveredTooling, undefined)) {
        return false;
      }

      project.discoveredTooling = undefined;
      return true;
    }

    const nextState = await this.configScanner.scanProject(
      project.id,
      project.path,
      project.discoveredTooling,
    );
    if (this.equalDiscoveredToolingState(project.discoveredTooling, nextState)) {
      return false;
    }

    project.discoveredTooling = nextState;
    return true;
  }

  private async probeAllAcceptedMcpServers(workspace: WorkspaceState): Promise<void> {
    const targets = [
      ...this.listAcceptedDiscoveredServerDefinitions(
        workspace,
        (server) => !server.probedTools || server.probedTools.length === 0,
      ),
      ...workspace.settings.tooling.mcpServers.filter(
        (server) => server.tools.length === 0 && (!server.probedTools || server.probedTools.length === 0),
      ),
    ];

    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  private async probeDiscoveredMcpServersFromState(
    workspace: WorkspaceState,
    state?: DiscoveredToolingState,
  ): Promise<void> {
    const targets = listAcceptedDiscoveredMcpServers(state)
      .filter((server) => !server.probedTools || server.probedTools.length === 0)
      .map((server) => this.discoveredServerToDefinition(server));
    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  private async probeDiscoveredMcpServers(
    workspace: WorkspaceState,
    state: DiscoveredToolingState | undefined,
    serverIds: ReadonlyArray<string>,
  ): Promise<void> {
    const targets = listAcceptedDiscoveredMcpServers(state)
      .filter((server) => serverIds.includes(server.id))
      .map((server) => this.discoveredServerToDefinition(server));
    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  private async probeWorkspaceMcpServers(
    workspace: WorkspaceState,
    targets: ReadonlyArray<McpServerDefinition>,
  ): Promise<void> {
    const uniqueTargets = [...new Map(targets.map((server) => [server.id, server])).values()];
    if (uniqueTargets.length === 0) {
      return;
    }

    const targetIds = uniqueTargets.map((server) => server.id);
    const tokenLookup = (url: string) => getStoredToken(url)?.accessToken;
    await this.enqueueMcpProbeUpdate(async () => {
      if (this.addMcpProbingServerIds(workspace, targetIds)) {
        await this.persistAndBroadcast(workspace);
      }
    });

    try {
      await this.probeMcpServers(uniqueTargets, tokenLookup, (result) =>
        this.enqueueMcpProbeUpdate(async () => {
          const didUpdateProbing = this.removeMcpProbingServerIds(workspace, [result.serverId]);
          const didApplyResult = this.applyMcpProbeResult(workspace, result);
          if (didUpdateProbing || didApplyResult) {
            await this.persistAndBroadcast(workspace);
          }
        }),
      );
    } finally {
      await this.enqueueMcpProbeUpdate(async () => {
        if (this.removeMcpProbingServerIds(workspace, targetIds)) {
          await this.persistAndBroadcast(workspace);
        }
      });
    }
  }

  /**
   * Re-probes all MCP servers matching a given URL after OAuth authentication
   * succeeds, so their tools appear in the approval pill without restart.
   */
  private async reprobeServerByUrl(serverUrl: string): Promise<void> {
    const workspace = await this.loadWorkspace();

    // Collect matching servers from manual config and discovered tooling
    const targets: McpServerDefinition[] = [];

    for (const server of workspace.settings.tooling.mcpServers) {
      if (server.transport !== 'local' && server.url === serverUrl) {
        targets.push(server);
      }
    }

    const allDiscovered = [
      ...(workspace.settings.discoveredUserTooling?.mcpServers ?? []),
      ...workspace.projects.flatMap((p) => p.discoveredTooling?.mcpServers ?? []),
    ];
    for (const server of allDiscovered) {
      if (server.status === 'accepted' && server.transport !== 'local' && server.url === serverUrl) {
        targets.push(this.discoveredServerToDefinition(server));
      }
    }

    await this.probeWorkspaceMcpServers(workspace, targets);
  }

  private listAcceptedDiscoveredServerDefinitions(
    workspace: WorkspaceState,
    predicate?: (server: DiscoveredMcpServer) => boolean,
  ): McpServerDefinition[] {
    const definitions: McpServerDefinition[] = [];

    for (const state of this.listDiscoveredToolingStates(workspace)) {
      for (const server of listAcceptedDiscoveredMcpServers(state)) {
        if (predicate && !predicate(server)) {
          continue;
        }
        definitions.push(this.discoveredServerToDefinition(server));
      }
    }

    return definitions;
  }

  private listDiscoveredToolingStates(workspace: WorkspaceState): Array<DiscoveredToolingState | undefined> {
    return [
      workspace.settings.discoveredUserTooling,
      ...workspace.projects.map((project) => project.discoveredTooling),
    ];
  }

  private addMcpProbingServerIds(workspace: WorkspaceState, serverIds: ReadonlyArray<string>): boolean {
    return this.updateMcpProbingServerIds(workspace, serverIds, 'add');
  }

  private removeMcpProbingServerIds(workspace: WorkspaceState, serverIds: ReadonlyArray<string>): boolean {
    return this.updateMcpProbingServerIds(workspace, serverIds, 'remove');
  }

  private updateMcpProbingServerIds(
    workspace: WorkspaceState,
    serverIds: ReadonlyArray<string>,
    operation: 'add' | 'remove',
  ): boolean {
    const next = new Set(workspace.mcpProbingServerIds ?? []);
    const before = next.size;

    for (const serverId of serverIds) {
      if (operation === 'add') {
        next.add(serverId);
      } else {
        next.delete(serverId);
      }
    }

    if (next.size === before) {
      return false;
    }

    if (next.size === 0) {
      delete workspace.mcpProbingServerIds;
    } else {
      workspace.mcpProbingServerIds = [...next];
    }

    return true;
  }

  private applyMcpProbeResult(workspace: WorkspaceState, result: McpProbeResult): boolean {
    if (result.status !== 'success' || result.tools.length === 0) {
      return false;
    }

    let changed = false;

    for (const server of workspace.settings.tooling.mcpServers) {
      if (server.id !== result.serverId) {
        continue;
      }
      server.probedTools = result.tools;
      changed = true;
    }

    for (const state of this.listDiscoveredToolingStates(workspace)) {
      for (const server of state?.mcpServers ?? []) {
        if (server.id !== result.serverId) {
          continue;
        }
        server.probedTools = result.tools;
        changed = true;
      }
    }

    return changed;
  }

  private async enqueueMcpProbeUpdate(update: () => Promise<void>): Promise<void> {
    const next = this.mcpProbeUpdateQueue.then(update, update);
    this.mcpProbeUpdateQueue = next.catch(() => undefined);
    await next;
  }

  private discoveredServerToDefinition(server: DiscoveredMcpServer): McpServerDefinition {
    if (server.transport === 'local') {
      return {
        id: server.id,
        name: server.name,
        transport: 'local',
        command: server.command,
        args: [...server.args],
        cwd: server.cwd,
        env: server.env ? { ...server.env } : undefined,
        tools: [...server.tools],
        timeoutMs: server.timeoutMs,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    }

    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      url: server.url,
      headers: server.headers ? { ...server.headers } : undefined,
      tools: [...server.tools],
      timeoutMs: server.timeoutMs,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
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
    return resolution === 'accept' ? 'accepted' : 'dismissed';
  }

  private equalDiscoveredToolingState(
    left?: DiscoveredToolingState,
    right?: DiscoveredToolingState,
  ): boolean {
    const stripRuntime = (servers: DiscoveredMcpServer[]) =>
      servers.map(({ probedTools: _, ...rest }) => rest);
    return JSON.stringify(stripRuntime(normalizeDiscoveredToolingState(left).mcpServers))
      === JSON.stringify(stripRuntime(normalizeDiscoveredToolingState(right).mcpServers));
  }

  private equalProjectCustomizationState(
    left?: ProjectCustomizationState,
    right?: ProjectCustomizationState,
  ): boolean {
    const normalizedLeft = normalizeProjectCustomizationState(left);
    const normalizedRight = normalizeProjectCustomizationState(right);
    return JSON.stringify({
      instructions: normalizedLeft.instructions,
      agentProfiles: normalizedLeft.agentProfiles,
      promptFiles: normalizedLeft.promptFiles,
    }) === JSON.stringify({
      instructions: normalizedRight.instructions,
      agentProfiles: normalizedRight.agentProfiles,
      promptFiles: normalizedRight.promptFiles,
    });
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
        this.pendingUserInputHandles.delete(session.pendingUserInput.id);
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
    const matchingRun = session.runs.find((run) =>
      run.events.some((event) => event.kind === 'approval' && event.approvalId === approvalId));
    if (matchingRun) {
      return matchingRun.requestId;
    }

    return session.runs.find((run) => run.status === 'running')?.requestId;
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
