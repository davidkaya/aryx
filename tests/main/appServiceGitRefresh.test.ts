import { describe, expect, mock, test } from 'bun:test';

import type { RunTurnCommand } from '@shared/contracts/sidecar';
import type { WorkflowDefinition } from '@shared/domain/workflow';
import type {
  ProjectGitRunChangeSummary,
  ProjectGitWorkingTreeSnapshot,
  ProjectRecord,
} from '@shared/domain/project';
import { SCRATCHPAD_PROJECT_ID } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-31T00:00:00.000Z';

mock.module('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
      getPath: () => 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures',
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: {
      openPath: async () => '',
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { AryxAppService } = await import('@main/AryxAppService');

function createProject(overrides?: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: 'project-alpha',
    name: 'alpha',
    path: 'C:\\workspace\\alpha',
    addedAt: TIMESTAMP,
    git: {
      status: 'ready',
      scannedAt: TIMESTAMP,
      repoRoot: 'C:\\workspace\\alpha',
      branch: 'main',
      isDirty: false,
      changedFileCount: 0,
      changes: {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
      },
    },
    ...overrides,
  };
}

function createSession(projectId: string, workflowId: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-alpha',
    projectId,
    workflowId,
    title: 'Alpha session',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [],
    runs: [],
    ...overrides,
  };
}

function createFixture(overrides?: {
  project?: Partial<ProjectRecord>;
  session?: Partial<SessionRecord>;
}): {
  workspace: WorkspaceState;
  pattern: WorkflowDefinition;
  project: ProjectRecord;
  session: SessionRecord;
} {
  const workspace = createWorkspaceSeed();
  const pattern = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
  if (!pattern) {
    throw new Error('Expected the workspace seed to include a single-agent pattern.');
  }

  const project = createProject(overrides?.project);
  const session = createSession(project.id, pattern.id, overrides?.session);

  workspace.projects = [project];
  workspace.sessions = [session];
  workspace.selectedProjectId = project.id;
  workspace.selectedWorkflowId = pattern.id;
  workspace.selectedSessionId = session.id;

  return { workspace, pattern, project, session };
}

function createSnapshot(): ProjectGitWorkingTreeSnapshot {
  return {
    scannedAt: TIMESTAMP,
    repoRoot: 'C:\\workspace\\alpha',
    branch: 'main',
    changedFileCount: 2,
    changes: {
      staged: 1,
      unstaged: 1,
      untracked: 0,
      conflicted: 0,
    },
    files: [
      {
        path: 'src\\auth.ts',
        stagedStatus: 'modified',
      },
      {
        path: 'tests\\auth.test.ts',
        unstagedStatus: 'modified',
      },
    ],
  };
}

function createRunSummary(): ProjectGitRunChangeSummary {
  return {
    generatedAt: TIMESTAMP,
    branchAtStart: 'main',
    branchAtEnd: 'main',
    fileCount: 1,
    additions: 4,
    deletions: 1,
    counts: {
      added: 1,
      modified: 0,
      deleted: 0,
      renamed: 0,
      copied: 0,
      typeChanged: 0,
      unmerged: 0,
      untracked: 0,
      cleaned: 0,
    },
    files: [
      {
        path: 'src\\generated.ts',
        kind: 'added',
        origin: 'run-created',
        additions: 4,
        deletions: 1,
        canRevert: true,
        preview: {
          path: 'src\\generated.ts',
          diff: '@@ -0,0 +1,4 @@\n+export const generated = true;\n',
        },
      },
    ],
  };
}

function createService(
  workspace: WorkspaceState,
  pattern: WorkflowDefinition,
  options?: {
    snapshot?: ProjectGitWorkingTreeSnapshot;
    runSummary?: ProjectGitRunChangeSummary;
    onCaptureSnapshot?: (projectPath: string, scannedAt: string) => void;
    onComputeRunSummary?: (projectPath: string) => void;
    onScheduleRefresh?: (projectId?: string) => void;
    runTurn?: (command: RunTurnCommand) => Promise<[]>;
  },
): InstanceType<typeof AryxAppService> {
  const service = new AryxAppService({
    gitService: {
      captureWorkingTreeSnapshot: async (projectPath: string, scannedAt: string) => {
        options?.onCaptureSnapshot?.(projectPath, scannedAt);
        return options?.snapshot;
      },
      captureWorkingTreeBaseline: async () => [],
      computeRunChangeSummary: async (projectPath: string) => {
        options?.onComputeRunSummary?.(projectPath);
        return options?.runSummary;
      },
    } as never,
  });
  const internals = service as unknown as Record<string, unknown>;
  internals.loadWorkspace = async () => {
    internals.workspace = workspace;
    return workspace;
  };
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => nextWorkspace;
  internals.buildEffectivePattern = async () => pattern;
  internals.awaitFinalResponseApproval = async () => undefined;
  internals.finalizeTurn = () => undefined;
  internals.emitSessionEvent = () => undefined;
  internals.pruneUnavailableApprovalTools = async () => false;
  internals.pruneUnavailableSessionToolingSelections = () => false;
  internals.scheduleProjectGitRefresh = (projectId?: string) => {
    options?.onScheduleRefresh?.(projectId);
  };

  (
    service as unknown as {
      sidecar: {
        runTurn: (command: RunTurnCommand) => Promise<[]>;
        resolveApproval: () => Promise<void>;
        resolveUserInput: () => Promise<void>;
      };
      gitService: {
        captureWorkingTreeSnapshot: (
          projectPath: string,
          scannedAt: string,
        ) => Promise<ProjectGitWorkingTreeSnapshot | undefined>;
        captureWorkingTreeBaseline: () => Promise<[]>;
        computeRunChangeSummary: (projectPath: string) => Promise<ProjectGitRunChangeSummary | undefined>;
      };
    }
    ).sidecar = {
    runTurn: async (command) => options?.runTurn ? options.runTurn(command) : [],
    resolveApproval: async () => undefined,
    resolveUserInput: async () => undefined,
  };

  return service;
}

describe('AryxAppService git refresh integration', () => {
  test('sendSessionMessage stores a pre-run git snapshot on the created run', async () => {
    const { workspace, pattern, session } = createFixture();
    const snapshot = createSnapshot();
    const capturedProjectPaths: string[] = [];
    const service = createService(workspace, pattern, {
      snapshot,
      onCaptureSnapshot: (projectPath) => {
        capturedProjectPaths.push(projectPath);
      },
    });

    await service.sendSessionMessage(session.id, 'Implement auth hardening.');

    expect(capturedProjectPaths).toEqual(['C:\\workspace\\alpha']);
    expect(workspace.sessions[0]?.runs[0]?.preRunGitSnapshot).toEqual(snapshot);
  });

  test('sendSessionMessage schedules a git refresh after a successful project turn', async () => {
    const { workspace, pattern, project, session } = createFixture();
    const scheduledProjectIds: Array<string | undefined> = [];
    const service = createService(workspace, pattern, {
      snapshot: createSnapshot(),
      onScheduleRefresh: (projectId) => {
        scheduledProjectIds.push(projectId);
      },
    });

    await service.sendSessionMessage(session.id, 'Implement auth hardening.');

    expect(scheduledProjectIds).toEqual([project.id]);
  });

  test('sendSessionMessage stores a post-run git summary on the completed run', async () => {
    const { workspace, pattern, session, project } = createFixture();
    const computedProjectPaths: string[] = [];
    const service = createService(workspace, pattern, {
      snapshot: createSnapshot(),
      runSummary: createRunSummary(),
      onComputeRunSummary: (projectPath) => {
        computedProjectPaths.push(projectPath);
      },
    });

    await service.sendSessionMessage(session.id, 'Implement auth hardening.');

    expect(computedProjectPaths).toEqual([project.path]);
    expect(workspace.sessions[0]?.runs[0]?.postRunGitSummary).toEqual(createRunSummary());
  });

  test('sendSessionMessage schedules a git refresh after a failed project turn', async () => {
    const { workspace, pattern, project, session } = createFixture();
    const scheduledProjectIds: Array<string | undefined> = [];
    const service = createService(workspace, pattern, {
      snapshot: createSnapshot(),
      onScheduleRefresh: (projectId) => {
        scheduledProjectIds.push(projectId);
      },
      runTurn: async () => {
        throw new Error('boom');
      },
    });

    await service.sendSessionMessage(session.id, 'Implement auth hardening.');

    expect(scheduledProjectIds).toEqual([project.id]);
    expect(session.status).toBe('error');
    expect(session.lastError).toBe('boom');
    expect(session.runs[0]?.status).toBe('error');
  });

  test('scratchpad turns skip git snapshot capture and refresh scheduling', async () => {
    const { workspace, pattern, session } = createFixture({
      project: {
        id: SCRATCHPAD_PROJECT_ID,
        name: 'Scratchpad',
        path: 'C:\\workspace\\scratchpad',
        git: undefined,
      },
      session: {
        projectId: SCRATCHPAD_PROJECT_ID,
      },
    });
    let didCaptureSnapshot = false;
    const scheduledProjectIds: Array<string | undefined> = [];
    const service = createService(workspace, pattern, {
      snapshot: createSnapshot(),
      onCaptureSnapshot: () => {
        didCaptureSnapshot = true;
      },
      onScheduleRefresh: (projectId) => {
        scheduledProjectIds.push(projectId);
      },
    });

    await service.sendSessionMessage(session.id, 'Draft a quick note.');

    expect(didCaptureSnapshot).toBe(false);
    expect(scheduledProjectIds).toEqual([]);
    expect(workspace.sessions[0]?.runs[0]?.preRunGitSnapshot).toBeUndefined();
  });

  test('setGitAutoRefreshEnabled persists the setting and returns updated workspace', async () => {
    const { workspace, pattern } = createFixture();
    const service = createService(workspace, pattern);

    expect(service.isGitAutoRefreshEnabled()).toBe(true);

    const result = await service.setGitAutoRefreshEnabled(false);
    expect(result.settings.gitAutoRefreshEnabled).toBe(false);
    expect(service.isGitAutoRefreshEnabled()).toBe(false);
  });

  test('isGitAutoRefreshEnabled defaults to true when setting is undefined', async () => {
    const { workspace, pattern } = createFixture();
    const service = createService(workspace, pattern);

    expect(workspace.settings.gitAutoRefreshEnabled).toBeUndefined();
    expect(service.isGitAutoRefreshEnabled()).toBe(true);
  });
});
