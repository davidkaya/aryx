import { EventEmitter } from 'node:events';
import { basename } from 'node:path';

import { dialog } from 'electron';

import type {
  AgentActivityEvent,
  RunTurnLspProfileConfig,
  RunTurnMcpServerConfig,
  RunTurnToolingConfig,
  SidecarCapabilities,
  TurnDeltaEvent,
} from '@shared/contracts/sidecar';
import {
  buildAvailableModelCatalog,
  findModel,
  normalizePatternModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import {
  isReasoningEffort,
  type PatternDefinition,
  type ReasoningEffort,
  validatePatternDefinition,
} from '@shared/domain/pattern';
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
  applyScratchpadSessionConfig,
  resolveSessionToolingSelection,
  createScratchpadSessionConfig,
  resolveSessionTitle,
  type ChatMessageRecord,
  type SessionRecord,
} from '@shared/domain/session';
import {
  appendRunActivityEvent,
  completeSessionRunRecord,
  createSessionRunRecord,
  failSessionRunRecord,
  upsertRunMessageEvent,
  upsertSessionRunRecord,
  type SessionRunRecord,
} from '@shared/domain/runTimeline';
import {
  createSessionToolingSelection,
  normalizeTheme,
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
import { SidecarClient } from '@main/sidecar/sidecarProcess';
import { GitService } from '@main/git/gitService';

type AppServiceEvents = {
  'workspace-updated': [WorkspaceState];
  'session-event': [SessionEventRecord];
};

function isBuiltinPattern(patternId: string): boolean {
  return patternId.startsWith('pattern-');
}

export class EryxAppService extends EventEmitter<AppServiceEvents> {
  private readonly workspaceRepository = new WorkspaceRepository();
  private readonly sidecar = new SidecarClient();
  private readonly secretStore = new SecretStore();
  private readonly gitService = new GitService();
  private workspace?: WorkspaceState;
  private sidecarCapabilities?: SidecarCapabilities;
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
    }

    if (!this.didScheduleInitialProjectGitRefresh) {
      this.didScheduleInitialProjectGitRefresh = true;
      void this.refreshProjectGitContext().catch((error) => {
        console.error('[eryx git]', error);
      });
    }

    return this.workspace;
  }

  async dispose(): Promise<void> {
    await this.sidecar.dispose();
    void this.secretStore;
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

  async savePattern(pattern: PatternDefinition): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const issues = validatePatternDefinition(pattern).filter((issue) => issue.level === 'error');
    if (issues.length > 0) {
      throw new Error(issues[0].message);
    }

    const existingIndex = workspace.patterns.findIndex((current) => current.id === pattern.id);
    const candidate: PatternDefinition = {
      ...pattern,
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
      scratchpadConfig: isScratchpadProject(project)
        ? createScratchpadSessionConfig(normalizedPattern)
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
    const project = this.requireProject(workspace, session.projectId);
    const pattern = this.requirePattern(workspace, session.patternId);
    const effectivePattern = await this.buildEffectivePattern(project, pattern, session);

    const trimmed = content.trim();
    if (!trimmed) {
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
      content: trimmed,
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
          tooling: this.buildRunTurnToolingConfig(workspace, project, session),
        },
        async (event) => {
          await this.applyTurnDelta(workspace, session.id, requestId, event);
        },
        async (event) => {
          await this.applyAgentActivity(workspace, session.id, requestId, event);
        },
      );

      this.finalizeTurn(workspace, session.id, requestId, responseMessages);
      await this.persistAndBroadcast(workspace);
    } catch (error) {
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

  async updateScratchpadSessionConfig(
    sessionId: string,
    model: string,
    reasoningEffort?: ReasoningEffort,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const project = this.requireProject(workspace, session.projectId);
    const modelCatalog = await this.loadAvailableModelCatalog();

    if (!isScratchpadProject(project)) {
      throw new Error('Only scratchpad sessions can change model settings in chat.');
    }

    if (session.status === 'running') {
      throw new Error('Wait for the current scratchpad response to finish before changing model settings.');
    }

    const normalizedModel = model.trim();
    const selectedModel = normalizedModel ? findModel(normalizedModel, modelCatalog) : undefined;
    if (!selectedModel) {
      throw new Error(`Model "${model}" is not available.`);
    }
    if (reasoningEffort && !isReasoningEffort(reasoningEffort)) {
      throw new Error(`Reasoning effort "${reasoningEffort}" is not supported.`);
    }

    session.scratchpadConfig = {
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

    if (
      isScratchpadProject(project)
      && (selection.enabledMcpServerIds.length > 0 || selection.enabledLspProfileIds.length > 0)
    ) {
      throw new Error('Scratchpad sessions do not support MCP or LSP tools.');
    }

    const knownMcpServerIds = new Set(
      workspace.settings.tooling.mcpServers.map((server) => server.id),
    );
    const knownLspProfileIds = new Set(
      workspace.settings.tooling.lspProfiles.map((profile) => profile.id),
    );

    const unknownMcpServerIds = selection.enabledMcpServerIds.filter(
      (id) => !knownMcpServerIds.has(id),
    );
    if (unknownMcpServerIds.length > 0) {
      throw new Error(`Unknown MCP server "${unknownMcpServerIds[0]}".`);
    }

    const unknownLspProfileIds = selection.enabledLspProfileIds.filter(
      (id) => !knownLspProfileIds.has(id),
    );
    if (unknownLspProfileIds.length > 0) {
      throw new Error(`Unknown LSP profile "${unknownLspProfileIds[0]}".`);
    }

    session.tooling = selection;
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
    project: ProjectRecord,
    pattern: PatternDefinition,
    session: SessionRecord,
  ): Promise<PatternDefinition> {
    const patternWithSessionConfig = isScratchpadProject(project)
      ? applyScratchpadSessionConfig(pattern, session)
      : pattern;

    const modelCatalog = await this.loadAvailableModelCatalog();
    return normalizePatternModels(patternWithSessionConfig, modelCatalog);
  }

  private buildRunTurnToolingConfig(
    workspace: WorkspaceState,
    project: ProjectRecord,
    session: SessionRecord,
  ): RunTurnToolingConfig | undefined {
    if (isScratchpadProject(project)) {
      return undefined;
    }

    const selection = resolveSessionToolingSelection(session);
    const mcpServersById = new Map<string, McpServerDefinition>(
      workspace.settings.tooling.mcpServers.map((server) => [server.id, server]),
    );
    const lspProfilesById = new Map<string, LspProfileDefinition>(
      workspace.settings.tooling.lspProfiles.map((profile) => [profile.id, profile]),
    );

    const mcpServers = selection.enabledMcpServerIds.flatMap((id): RunTurnMcpServerConfig[] => {
      const server = mcpServersById.get(id);
      if (!server) {
        return [];
      }

      if (server.transport === 'local') {
        return [
          {
            id: server.id,
            name: server.name,
            transport: 'local',
            tools: [...server.tools],
            timeoutMs: server.timeoutMs,
            command: server.command,
            args: [...server.args],
            cwd: server.cwd,
          },
        ];
      }

      return [
        {
          id: server.id,
          name: server.name,
          transport: server.transport,
          tools: [...server.tools],
          timeoutMs: server.timeoutMs,
          url: server.url,
        },
      ];
    });

    const lspProfiles = selection.enabledLspProfileIds.flatMap(
      (id): RunTurnLspProfileConfig[] => {
        const profile = lspProfilesById.get(id);
        if (!profile) {
          return [];
        }

        return [
          {
            id: profile.id,
            name: profile.name,
            command: profile.command,
            args: [...profile.args],
            languageId: profile.languageId,
            fileExtensions: [...profile.fileExtensions],
          },
        ];
      },
    );

    if (mcpServers.length === 0 && lspProfiles.length === 0) {
      return undefined;
    }

    return {
      mcpServers,
      lspProfiles,
    };
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

  private async loadSidecarCapabilities(forceRefresh = false): Promise<SidecarCapabilities> {
    if (forceRefresh || !this.sidecarCapabilities) {
      this.sidecarCapabilities = await this.sidecar.describeCapabilities();
    }

    return this.sidecarCapabilities;
  }
}
