import { describe, expect, mock, test } from 'bun:test';

import type { ProjectRecord } from '@shared/domain/project';
import type { TerminalSnapshot } from '@shared/domain/terminal';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-28T00:00:00.000Z';

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
    id: 'project-1',
    name: 'Project One',
    path: 'C:\\workspace\\project-one',
    addedAt: TIMESTAMP,
    ...overrides,
  };
}

function createSession(patternId: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-1',
    projectId: 'project-1',
    patternId,
    title: 'Terminal Session',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [],
    runs: [],
    ...overrides,
  };
}

function createTerminalSnapshot(overrides?: Partial<TerminalSnapshot>): TerminalSnapshot {
  return {
    cwd: 'C:\\workspace\\project-one',
    shell: 'PowerShell',
    pid: 100,
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

function createService(workspace: WorkspaceState, terminalSnapshot = createTerminalSnapshot()) {
  let saveCalls = 0;
  const terminalCreateCwds: string[] = [];
  const terminalRestartCwds: string[] = [];
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  let killCalls = 0;
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;

  internals.workspaceRepository = {
    load: async () => workspace,
    save: async () => {
      saveCalls += 1;
    },
  };
  internals.syncUserDiscoveredTooling = async () => false;
  internals.syncProjectDiscoveredTooling = async () => false;
  internals.syncProjectCustomization = async () => false;
  internals.pruneUnavailableSessionToolingSelections = () => false;
  internals.pruneUnavailableApprovalTools = async () => false;
  internals.didScheduleInitialProjectGitRefresh = true;
  internals.ptyManager = {
    create: async (cwd: string) => {
      terminalCreateCwds.push(cwd);
      return { ...terminalSnapshot, cwd };
    },
    restart: async (cwd: string) => {
      terminalRestartCwds.push(cwd);
      return { ...terminalSnapshot, cwd };
    },
    kill: () => {
      killCalls += 1;
    },
    write: (data: string) => {
      writes.push(data);
    },
    resize: (cols: number, rows: number) => {
      resizes.push({ cols, rows });
    },
    getSnapshot: () => terminalSnapshot,
    dispose: () => undefined,
    on: () => internals.ptyManager,
  };

  return {
    service,
    getSaveCalls: () => saveCalls,
    terminalCreateCwds,
    terminalRestartCwds,
    writes,
    resizes,
    getKillCalls: () => killCalls,
  };
}

describe('AryxAppService terminal integration', () => {
  test('uses the selected session cwd when creating and restarting the terminal', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = workspace.patterns[0];
    if (!pattern) {
      throw new Error('Expected a seeded pattern.');
    }

    workspace.projects = [createProject()];
    workspace.sessions = [createSession(pattern.id, { cwd: 'C:\\workspace\\scratchpad\\session-1' })];
    workspace.selectedProjectId = 'project-1';
    workspace.selectedSessionId = 'session-1';

    const { service, terminalCreateCwds, terminalRestartCwds } = createService(workspace);

    await service.createTerminal();
    await service.restartTerminal();

    expect(terminalCreateCwds).toEqual(['C:\\workspace\\scratchpad\\session-1']);
    expect(terminalRestartCwds).toEqual(['C:\\workspace\\scratchpad\\session-1']);
  });

  test('falls back to the selected project path and delegates terminal controls', async () => {
    const workspace = createWorkspaceSeed();
    workspace.projects = [createProject()];
    workspace.selectedProjectId = 'project-1';

    const { service, terminalCreateCwds, writes, resizes, getKillCalls } = createService(workspace);

    await expect(service.describeTerminal()).resolves.toEqual(createTerminalSnapshot());
    await service.createTerminal();
    service.writeTerminal('dir\r');
    service.resizeTerminal(120, 40);
    await service.killTerminal();

    expect(terminalCreateCwds).toEqual(['C:\\workspace\\project-one']);
    expect(writes).toEqual(['dir\r']);
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(getKillCalls()).toBe(1);
  });

  test('normalizes and persists terminal height settings', async () => {
    const workspace = createWorkspaceSeed();
    const { service, getSaveCalls } = createService(workspace);

    await service.setTerminalHeight(240.4);
    expect(workspace.settings.terminalHeight).toBe(240);
    expect(getSaveCalls()).toBe(1);

    await service.setTerminalHeight(240);
    expect(getSaveCalls()).toBe(1);

    await service.setTerminalHeight(0);
    expect(workspace.settings.terminalHeight).toBeUndefined();
    expect(getSaveCalls()).toBe(2);
  });
});
