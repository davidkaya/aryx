import { EventEmitter } from 'node:events';
import { basename } from 'node:path';

import { dialog } from 'electron';

import type { TurnDeltaEvent } from '@shared/contracts/sidecar';
import { buildSessionTitle, validatePatternDefinition, type PatternDefinition } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionEventRecord } from '@shared/domain/event';
import type { ChatMessageRecord, SessionRecord } from '@shared/domain/session';
import type { WorkspaceState } from '@shared/domain/workspace';
import { createId, nowIso } from '@shared/utils/ids';

import { WorkspaceRepository } from '@main/persistence/workspaceRepository';
import { SecretStore } from '@main/secrets/secretStore';
import { SidecarClient } from '@main/sidecar/sidecarProcess';

type AppServiceEvents = {
  'workspace-updated': [WorkspaceState];
  'session-event': [SessionEventRecord];
};

function isBuiltinPattern(patternId: string): boolean {
  return patternId.startsWith('pattern-');
}

export class KopayaAppService extends EventEmitter<AppServiceEvents> {
  private readonly workspaceRepository = new WorkspaceRepository();
  private readonly sidecar = new SidecarClient();
  private readonly secretStore = new SecretStore();
  private workspace?: WorkspaceState;

  async loadWorkspace(): Promise<WorkspaceState> {
    if (!this.workspace) {
      this.workspace = await this.workspaceRepository.load();
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
    };

    workspace.projects.push(project);
    workspace.selectedProjectId = project.id;
    return this.persistAndBroadcast(workspace);
  }

  async removeProject(projectId: string): Promise<WorkspaceState> {
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

  async createSession(projectId: string, patternId: string): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    const pattern = this.requirePattern(workspace, patternId);

    const session: SessionRecord = {
      id: createId('session'),
      projectId: project.id,
      patternId: pattern.id,
      title: pattern.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'idle',
      messages: [],
    };

    workspace.sessions.unshift(session);
    workspace.selectedProjectId = project.id;
    workspace.selectedPatternId = pattern.id;
    workspace.selectedSessionId = session.id;
    return this.persistAndBroadcast(workspace);
  }

  async sendSessionMessage(sessionId: string, content: string): Promise<void> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const project = this.requireProject(workspace, session.projectId);
    const pattern = this.requirePattern(workspace, session.patternId);

    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    session.messages.push({
      id: createId('msg'),
      role: 'user',
      authorName: 'You',
      content: trimmed,
      createdAt: nowIso(),
    });
    session.title = buildSessionTitle(pattern, session.messages);
    session.status = 'running';
    session.lastError = undefined;
    session.updatedAt = nowIso();

    await this.persistAndBroadcast(workspace);
    this.emitSessionEvent({
      sessionId: session.id,
      kind: 'status',
      status: 'running',
      occurredAt: nowIso(),
    });

    const requestId = createId('turn');
    try {
      const responseMessages = await this.sidecar.runTurn(
        {
          type: 'run-turn',
          requestId,
          sessionId: session.id,
          projectPath: project.path,
          pattern,
          messages: session.messages,
        },
        async (event) => {
          await this.applyTurnDelta(workspace, session.id, event);
        },
      );

      this.finalizeTurn(workspace, session.id, responseMessages);
      await this.persistAndBroadcast(workspace);
    } catch (error) {
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = nowIso();

      this.emitSessionEvent({
        sessionId: session.id,
        kind: 'error',
        occurredAt: nowIso(),
        error: session.lastError,
      });

      await this.persistAndBroadcast(workspace);
    }
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
    event: TurnDeltaEvent,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const existing = session.messages.find((message) => message.id === event.messageId);

    if (existing) {
      existing.content += event.contentDelta;
      existing.pending = true;
    } else {
      session.messages.push({
        id: event.messageId,
        role: 'assistant',
        authorName: event.authorName,
        content: event.contentDelta,
        createdAt: nowIso(),
        pending: true,
      });
    }

    session.updatedAt = nowIso();
    await this.workspaceRepository.save(workspace);

    this.emitSessionEvent({
      sessionId,
      kind: 'message-delta',
      occurredAt: nowIso(),
      messageId: event.messageId,
      authorName: event.authorName,
      contentDelta: event.contentDelta,
    });
  }

  private finalizeTurn(workspace: WorkspaceState, sessionId: string, messages: ChatMessageRecord[]): void {
    const session = this.requireSession(workspace, sessionId);
    const incomingIds = new Set(messages.map((message) => message.id));

    for (const message of messages) {
      const existing = session.messages.find((current) => current.id === message.id);
      if (existing) {
        existing.authorName = message.authorName;
        existing.content = message.content;
        existing.pending = false;
      } else {
        session.messages.push({ ...message, pending: false });
      }

      this.emitSessionEvent({
        sessionId,
        kind: 'message-complete',
        occurredAt: nowIso(),
        messageId: message.id,
        authorName: message.authorName,
      });
    }

    for (const message of session.messages) {
      if (message.pending && incomingIds.has(message.id)) {
        message.pending = false;
      }
    }

    session.status = 'idle';
    session.lastError = undefined;
    session.updatedAt = nowIso();
    this.emitSessionEvent({
      sessionId,
      kind: 'status',
      occurredAt: nowIso(),
      status: 'idle',
    });
  }

  private async persistAndBroadcast(workspace: WorkspaceState): Promise<WorkspaceState> {
    await this.workspaceRepository.save(workspace);
    this.emit('workspace-updated', workspace);
    return workspace;
  }

  private emitSessionEvent(event: SessionEventRecord): void {
    this.emit('session-event', event);
  }
}
