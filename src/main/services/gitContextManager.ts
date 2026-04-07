import {
  isScratchpadProject,
  type ProjectGitDetails,
  type ProjectGitDiffPreview,
  type ProjectGitFileReference,
  type ProjectRecord,
} from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { setSessionRunGitSummary, type SessionRunRecord } from '@shared/domain/runTimeline';
import type { WorkspaceState } from '@shared/domain/workspace';
import { nowIso } from '@shared/utils/ids';

import { GitService } from '@main/git/gitService';

const GIT_REFRESH_DEBOUNCE_MS = 750;
const GIT_REFRESH_INTERVAL_MS = 60_000;

type GitContextManagerDeps = {
  gitService: GitService;
  loadWorkspace: () => Promise<WorkspaceState>;
  persistWorkspace: (workspace: WorkspaceState) => Promise<WorkspaceState>;
  requireProject: (workspace: WorkspaceState, projectId: string) => ProjectRecord;
  requireSession: (workspace: WorkspaceState, sessionId: string) => SessionRecord;
  requireSessionRun: (session: SessionRecord, runId: string) => SessionRunRecord;
  syncProjectDiscoveredTooling: (workspace: WorkspaceState, project: ProjectRecord) => Promise<boolean>;
  syncProjectCustomization: (project: ProjectRecord) => Promise<boolean>;
  pruneUnavailableSessionToolingSelections: (workspace: WorkspaceState) => boolean;
  pruneUnavailableApprovalTools: (workspace: WorkspaceState) => Promise<boolean>;
  updateSessionRun: (
    session: SessionRecord,
    requestId: string,
    updater: (run: SessionRunRecord) => SessionRunRecord,
  ) => SessionRunRecord | undefined;
  emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
};

export class GitContextManager {
  private readonly gitService: GitService;
  private readonly loadWorkspace: () => Promise<WorkspaceState>;
  private readonly persistWorkspace: (workspace: WorkspaceState) => Promise<WorkspaceState>;
  private readonly requireProject: (workspace: WorkspaceState, projectId: string) => ProjectRecord;
  private readonly requireSession: (workspace: WorkspaceState, sessionId: string) => SessionRecord;
  private readonly requireSessionRun: (session: SessionRecord, runId: string) => SessionRunRecord;
  private readonly syncProjectDiscoveredTooling: (workspace: WorkspaceState, project: ProjectRecord) => Promise<boolean>;
  private readonly syncProjectCustomization: (project: ProjectRecord) => Promise<boolean>;
  private readonly pruneUnavailableSessionToolingSelections: (workspace: WorkspaceState) => boolean;
  private readonly pruneUnavailableApprovalTools: (workspace: WorkspaceState) => Promise<boolean>;
  private readonly updateSessionRun: GitContextManagerDeps['updateSessionRun'];
  private readonly emitRunUpdated: GitContextManagerDeps['emitRunUpdated'];

  private didStartPeriodicProjectGitRefresh = false;
  private pendingProjectGitRefreshIds = new Set<string>();
  private pendingRefreshAllProjects = false;
  private projectGitRefreshTimer?: ReturnType<typeof setTimeout>;
  private periodicProjectGitRefreshTimer?: ReturnType<typeof setInterval>;
  private runningProjectGitRefresh?: Promise<void>;

  constructor(deps: GitContextManagerDeps) {
    this.gitService = deps.gitService;
    this.loadWorkspace = deps.loadWorkspace;
    this.persistWorkspace = deps.persistWorkspace;
    this.requireProject = deps.requireProject;
    this.requireSession = deps.requireSession;
    this.requireSessionRun = deps.requireSessionRun;
    this.syncProjectDiscoveredTooling = deps.syncProjectDiscoveredTooling;
    this.syncProjectCustomization = deps.syncProjectCustomization;
    this.pruneUnavailableSessionToolingSelections = deps.pruneUnavailableSessionToolingSelections;
    this.pruneUnavailableApprovalTools = deps.pruneUnavailableApprovalTools;
    this.updateSessionRun = deps.updateSessionRun;
    this.emitRunUpdated = deps.emitRunUpdated;
  }

  dispose(): void {
    if (this.projectGitRefreshTimer) {
      clearTimeout(this.projectGitRefreshTimer);
      this.projectGitRefreshTimer = undefined;
    }
    if (this.periodicProjectGitRefreshTimer) {
      clearInterval(this.periodicProjectGitRefreshTimer);
      this.periodicProjectGitRefreshTimer = undefined;
    }
    this.didStartPeriodicProjectGitRefresh = false;
  }

  scheduleProjectGitRefresh(projectId?: string): void {
    if (projectId) {
      this.pendingProjectGitRefreshIds.add(projectId);
    } else {
      this.pendingRefreshAllProjects = true;
      this.pendingProjectGitRefreshIds.clear();
    }

    if (this.projectGitRefreshTimer) {
      clearTimeout(this.projectGitRefreshTimer);
    }

    this.projectGitRefreshTimer = setTimeout(() => {
      this.projectGitRefreshTimer = undefined;
      void this.flushScheduledProjectGitRefresh();
    }, GIT_REFRESH_DEBOUNCE_MS);
    this.projectGitRefreshTimer.unref?.();
  }

  async refreshProjectGitContext(projectId?: string): Promise<WorkspaceState> {
    return this.refreshProjectGitContexts(projectId ? [projectId] : undefined);
  }

  async getProjectGitDetails(projectId: string, commitLimit = 20): Promise<ProjectGitDetails> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    return this.gitService.describeProjectGitDetails(project.path, nowIso(), commitLimit);
  }

  async getProjectGitFilePreview(
    projectId: string,
    file: ProjectGitFileReference,
  ): Promise<ProjectGitDiffPreview | undefined> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    return this.gitService.getWorkingTreeFilePreview(project.path, file);
  }

  async discardSessionRunGitChanges(
    sessionId: string,
    runId: string,
    files?: ProjectGitFileReference[],
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const session = this.requireSession(workspace, sessionId);
    const project = this.requireProject(workspace, session.projectId);
    const run = this.requireSessionRun(session, runId);
    if (run.workspaceKind !== 'project') {
      throw new Error('Run change review is only available for project-backed sessions.');
    }

    if (!run.postRunGitSummary) {
      throw new Error('This run does not have any tracked git changes to discard.');
    }

    await this.gitService.discardRunChanges(
      this.resolveRunWorkingDirectory(session, project, run),
      {
        summary: run.postRunGitSummary,
        preRunBaselineFiles: run.preRunGitBaselineFiles,
        files,
      },
    );

    await this.refreshProjectGitContexts([project.id]);
    const refreshedWorkspace = await this.loadWorkspace();
    const refreshedSession = this.requireSession(refreshedWorkspace, sessionId);
    const refreshedProject = this.requireProject(refreshedWorkspace, refreshedSession.projectId);
    const nextRun = await this.refreshSessionRunGitSummary(
      refreshedSession,
      refreshedProject,
      run.requestId,
      nowIso(),
    );
    if (nextRun) {
      this.emitRunUpdated(refreshedSession.id, nowIso(), nextRun);
    }

    return this.persistWorkspace(refreshedWorkspace);
  }

  async runProjectGitMutation(
    projectId: string,
    mutation: (project: ProjectRecord) => Promise<void>,
  ): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const project = this.requireProject(workspace, projectId);
    if (isScratchpadProject(project)) {
      throw new Error('Git operations are not available for the Scratchpad project.');
    }

    await mutation(project);
    return this.refreshProjectGitContexts([project.id]);
  }

  resolveRunWorkingDirectory(
    session: SessionRecord,
    project: ProjectRecord,
    run: SessionRunRecord,
  ): string {
    return run.workingDirectory ?? session.cwd ?? run.projectPath ?? project.path;
  }

  async refreshSessionRunGitSummary(
    session: SessionRecord,
    project: ProjectRecord,
    requestId: string,
    occurredAt: string,
  ): Promise<SessionRunRecord | undefined> {
    const run = session.runs.find((candidate) => candidate.requestId === requestId);
    if (!run || run.workspaceKind !== 'project' || !run.preRunGitSnapshot) {
      return undefined;
    }

    const summary = await this.gitService.computeRunChangeSummary(
      this.resolveRunWorkingDirectory(session, project, run),
      {
        generatedAt: occurredAt,
        preRunSnapshot: run.preRunGitSnapshot,
        preRunBaselineFiles: run.preRunGitBaselineFiles,
      },
    );

    return this.updateSessionRun(session, requestId, (currentRun) =>
      setSessionRunGitSummary(currentRun, summary));
  }

  async refreshProjectGitContexts(projectIds?: readonly string[]): Promise<WorkspaceState> {
    const workspace = await this.loadWorkspace();
    const projects = projectIds?.length
      ? projectIds.map((currentProjectId) => this.requireProject(workspace, currentProjectId))
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
      ? this.persistWorkspace(workspace)
      : workspace;
  }

  startPeriodicProjectGitRefresh(): void {
    if (this.didStartPeriodicProjectGitRefresh) {
      return;
    }

    this.didStartPeriodicProjectGitRefresh = true;
    this.periodicProjectGitRefreshTimer = setInterval(() => {
      this.scheduleProjectGitRefresh();
    }, GIT_REFRESH_INTERVAL_MS);
    this.periodicProjectGitRefreshTimer.unref?.();
  }

  stopPeriodicProjectGitRefresh(): void {
    if (this.periodicProjectGitRefreshTimer) {
      clearInterval(this.periodicProjectGitRefreshTimer);
      this.periodicProjectGitRefreshTimer = undefined;
    }
    this.didStartPeriodicProjectGitRefresh = false;
  }

  async flushScheduledProjectGitRefresh(): Promise<void> {
    if (this.runningProjectGitRefresh) {
      return;
    }

    const projectIds = this.pendingRefreshAllProjects
      ? undefined
      : [...this.pendingProjectGitRefreshIds];
    this.pendingRefreshAllProjects = false;
    this.pendingProjectGitRefreshIds.clear();

    this.runningProjectGitRefresh = this.refreshProjectGitContexts(projectIds).then(
      () => undefined,
      (error) => {
        console.error('[aryx git]', error);
      },
    );

    try {
      await this.runningProjectGitRefresh;
    } finally {
      this.runningProjectGitRefresh = undefined;
      if (this.pendingRefreshAllProjects || this.pendingProjectGitRefreshIds.size > 0) {
        this.scheduleProjectGitRefresh();
      }
    }
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
}
