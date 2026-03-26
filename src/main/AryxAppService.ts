import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import electron from 'electron';

import type {
  AgentActivityEvent,
  ApprovalRequestedEvent,
  RunTurnToolingConfig,
  SidecarCapabilities,
  TurnDeltaEvent,
  UserInputRequestedEvent,
} from '@shared/contracts/sidecar';
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
  normalizeDiscoveredToolingState,
  type DiscoveredToolingState,
  type DiscoveredToolingStatus,
} from '@shared/domain/discoveredTooling';
import {
  approvalPolicyRequiresCheckpoint,
  dequeuePendingApprovalState,
  enqueuePendingApprovalState,
  listPendingApprovals,
  normalizeApprovalPolicy,
  normalizeSessionApprovalSettings,
  pruneApprovalPolicyTools,
  pruneSessionApprovalSettings,
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
  normalizeTheme,
  resolveProjectToolingSettings,
  resolveWorkspaceToolingSettings,
  type AppearanceTheme,
  type LspProfileDefinition,
  type McpServerDefinition,
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
import { SecretStore } from '@main/secrets/secretStore';
import { ConfigScannerRegistry } from '@main/services/configScanner';
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

const { dialog, shell } = electron;

type AppServiceEvents = {
  'workspace-updated': [WorkspaceState];
  'session-event': [SessionEventRecord];
};

type PendingApprovalHandle = {
  sessionId: string;
  requestId: string;
  resolve: (decision: ApprovalDecision) => void | Promise<void>;
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

export class AryxAppService extends EventEmitter<AppServiceEvents> {
  private readonly workspaceRepository = new WorkspaceRepository();
  private readonly sidecar = new SidecarClient();
  private readonly secretStore = new SecretStore();
  private readonly gitService = new GitService();
  private readonly configScanner = new ConfigScannerRegistry();
  private readonly pendingApprovalHandles = new Map<string, PendingApprovalHandle>();
  private readonly pendingUserInputHandles = new Map<string, PendingUserInputHandle>();
  private workspace?: WorkspaceState;
  private sidecarCapabilities?: SidecarCapabilities;
  private sidecarCapabilitiesPromise?: Promise<SidecarCapabilities>;
  private didScheduleInitialProjectGitRefresh = false;

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
      const didPruneSelections = this.pruneUnavailableSessionToolingSelections(this.workspace);
      const didPruneApprovalTools = await this.pruneUnavailableApprovalTools(this.workspace);
      if (
        didSyncUserTooling
        || didSyncProjectTooling
        || didPruneSelections
        || didPruneApprovalTools
        || this.failInterruptedPendingApprovals(this.workspace)
      ) {
        await this.workspaceRepository.save(this.workspace);
      }
    }

    if (!this.didScheduleInitialProjectGitRefresh) {
      this.didScheduleInitialProjectGitRefresh = true;
      void this.refreshProjectGitContext().catch((error) => {
        console.error('[aryx git]', error);
      });
    }

    return this.workspace;
  }

  async dispose(): Promise<void> {
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

    return this.loadWorkspace();
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
    return this.persistAndBroadcast(workspace);
  }

  async rescanProjectConfigs(projectId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    await this.syncProjectDiscoveredTooling(workspace, project);
    this.pruneUnavailableSessionToolingSelections(workspace);
    await this.pruneUnavailableApprovalTools(workspace);
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
    return this.persistAndBroadcast(workspace);
  }

  async savePattern(pattern: PatternDefinition): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const knownApprovalToolNames = await this.listKnownApprovalToolNames(workspace);
    const synchronizedPattern = syncPatternGraph(pattern);
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

  async sendSessionMessage(sessionId: string, content: string): Promise<void> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    if (session.status === 'running') {
      throw new Error('Wait for the current response or approval checkpoint to finish before sending another message.');
    }
    const project = this.requireProject(workspace, session.projectId);
    const pattern = this.requirePattern(workspace, session.patternId);
    const effectivePattern = await this.buildEffectivePattern(pattern, session);

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
    });
    session.title = resolveSessionTitle(session, effectivePattern, session.messages);
    session.status = 'running';
    session.lastError = undefined;
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
          projectPath: project.path,
          workspaceKind,
          pattern: effectivePattern,
          messages: session.messages,
          tooling: this.buildRunTurnToolingConfig(workspace, session),
        },
        async (event) => {
          await this.applyTurnDelta(workspace, session.id, requestId, event);
        },
        async (event) => {
          await this.applyAgentActivity(workspace, session.id, requestId, event);
        },
        async (event) => {
          await this.handleApprovalRequested(workspace, session.id, requestId, event, (decision) =>
            this.sidecar.resolveApproval(event.approvalId, decision));
        },
        async (event) => {
          await this.handleUserInputRequested(workspace, session.id, requestId, event, (answer, wasFreeform) =>
            this.sidecar.resolveUserInput(event.userInputId, answer, wasFreeform));
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

    const updatedRun = this.updateSessionRun(session, handle.requestId, (run) =>
      upsertRunApprovalEvent(run, resolvedApproval));

    const result = await this.persistAndBroadcast(workspace);
    if (updatedRun) {
      this.emitRunUpdated(sessionId, resolvedAt, updatedRun);
    }

    this.pendingApprovalHandles.delete(approvalId);

    try {
      await Promise.resolve(handle.resolve(decision));
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

    session.tooling = selection;
    session.updatedAt = nowIso();
    return this.persistAndBroadcast(workspace);
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

  async refreshProjectGitContext(projectId?: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const projects = projectId
      ? [this.requireProject(workspace, projectId)]
      : workspace.projects;

    let changed = false;
    for (const project of projects) {
      const projectChanged = await this.refreshGitContextForProject(project);
      changed = projectChanged || changed;
    }

    return changed ? this.persistAndBroadcast(workspace) : workspace;
  }

  async selectProject(projectId?: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    if (projectId) {
      const project = this.requireProject(workspace, projectId);
      const didSyncProjectTooling = await this.syncProjectDiscoveredTooling(workspace, project);
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

    if (existing) {
      existing.content = content;
      existing.pending = true;
      existing.authorName = event.authorName;
    } else {
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
    resolve: (decision: ApprovalDecision) => void | Promise<void>,
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
    return buildSessionToolingConfig(tooling, selection);
  }

  private async syncUserDiscoveredTooling(workspace: WorkspaceState): Promise<boolean> {
    const nextState = await this.configScanner.scanUser(workspace.settings.discoveredUserTooling);
    if (this.equalDiscoveredToolingState(workspace.settings.discoveredUserTooling, nextState)) {
      return false;
    }

    workspace.settings.discoveredUserTooling = nextState;
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
    return JSON.stringify(normalizeDiscoveredToolingState(left).mcpServers)
      === JSON.stringify(normalizeDiscoveredToolingState(right).mcpServers);
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

  private failInterruptedPendingApprovals(workspace: WorkspaceState): boolean {
    let changed = false;

    for (const session of workspace.sessions) {
      const pendingApprovals = listPendingApprovals(session);
      if (pendingApprovals.length === 0) {
        continue;
      }

      changed = true;
      const failedAt = nowIso();
      const error = 'Pending approval was interrupted because Aryx restarted before a decision was recorded.';
      const requestIds = this.rejectPendingApprovals(session, failedAt, error);
      session.status = 'error';
      session.lastError = error;
      session.updatedAt = failedAt;

      if (requestIds.length === 0) {
        const fallbackRequestId = session.runs.find((run) => run.status === 'running')?.requestId;
        if (fallbackRequestId) {
          requestIds.push(fallbackRequestId);
        }
      }

      for (const requestId of requestIds) {
        this.updateSessionRun(session, requestId, (run) =>
          failSessionRunRecord(run, failedAt, error));
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
