import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { PatternDefinition } from '@shared/domain/pattern';
import { createScratchpadProject } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-28T00:00:00.000Z';
const USER_DATA_PATH = 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures';

mock.module('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
      getPath: () => USER_DATA_PATH,
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requireSinglePattern(workspace: WorkspaceState): PatternDefinition {
  const pattern = workspace.patterns.find((candidate) => candidate.mode === 'single');
  if (!pattern) {
    throw new Error('Expected the workspace seed to include a single-agent pattern.');
  }

  return pattern;
}

function createScratchpadSession(patternId: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-scratchpad',
    projectId: 'project-scratchpad',
    patternId,
    title: 'Scratchpad',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [],
    runs: [],
    ...overrides,
  };
}

function createService(
  workspace: WorkspaceState,
  options?: {
    onDeleteSession?: (sessionId: string) => Promise<void>;
  },
): InstanceType<typeof AryxAppService> {
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;
  internals.loadWorkspace = async () => workspace;
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => nextWorkspace;
  internals.loadAvailableModelCatalog = async () => [];

  (
    service as unknown as {
      sidecar: {
        deleteSession: (sessionId: string) => Promise<void>;
      };
    }
  ).sidecar = {
    deleteSession: async (sessionId: string) => {
      await options?.onDeleteSession?.(sessionId);
    },
  };

  return service;
}

beforeEach(async () => {
  await rm(join(USER_DATA_PATH, 'scratchpad'), { recursive: true, force: true });
});

afterEach(async () => {
  await rm(join(USER_DATA_PATH, 'scratchpad'), { recursive: true, force: true });
});

describe('AryxAppService scratchpad directories', () => {
  test('creates a dedicated directory for new scratchpad sessions', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requireSinglePattern(workspace);
    const scratchpadProject = createScratchpadProject(join(USER_DATA_PATH, 'scratchpad'), TIMESTAMP);
    workspace.projects = [scratchpadProject];
    workspace.selectedProjectId = scratchpadProject.id;
    workspace.selectedPatternId = pattern.id;

    const service = createService(workspace);

    const result = await service.createSession(scratchpadProject.id, pattern.id);
    const session = result.sessions[0];
    if (!session) {
      throw new Error('Expected createSession to prepend a scratchpad session.');
    }

    expect(session.cwd).toBe(join(USER_DATA_PATH, 'scratchpad', session.id));
    expect(await pathExists(session.cwd!)).toBe(true);
  });

  test('creates a new directory when duplicating a scratchpad session', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requireSinglePattern(workspace);
    const scratchpadProject = createScratchpadProject(join(USER_DATA_PATH, 'scratchpad'), TIMESTAMP);
    const originalDirectory = join(USER_DATA_PATH, 'scratchpad', 'session-original');
    const originalSession = createScratchpadSession(pattern.id, {
      id: 'session-original',
      cwd: originalDirectory,
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Draft a plan.',
          createdAt: TIMESTAMP,
        },
      ],
    });

    workspace.projects = [scratchpadProject];
    workspace.sessions = [originalSession];
    workspace.selectedProjectId = scratchpadProject.id;
    workspace.selectedPatternId = pattern.id;
    workspace.selectedSessionId = originalSession.id;

    const service = createService(workspace);

    const result = await service.duplicateSession(originalSession.id);
    const duplicate = result.sessions[0];
    if (!duplicate) {
      throw new Error('Expected duplicateSession to prepend the duplicate.');
    }

    expect(duplicate.id).not.toBe(originalSession.id);
    expect(duplicate.cwd).toBe(join(USER_DATA_PATH, 'scratchpad', duplicate.id));
    expect(duplicate.cwd).not.toBe(originalSession.cwd);
    expect(await pathExists(duplicate.cwd!)).toBe(true);
  });

  test('creates a new directory when branching a scratchpad session', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requireSinglePattern(workspace);
    const scratchpadProject = createScratchpadProject(join(USER_DATA_PATH, 'scratchpad'), TIMESTAMP);
    const originalDirectory = join(USER_DATA_PATH, 'scratchpad', 'session-original');
    const originalSession = createScratchpadSession(pattern.id, {
      id: 'session-original',
      cwd: originalDirectory,
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Draft a plan.',
          createdAt: TIMESTAMP,
        },
        {
          id: 'msg-2',
          role: 'assistant',
          authorName: 'Primary Agent',
          content: 'Here is the first approach.',
          createdAt: TIMESTAMP,
        },
        {
          id: 'msg-3',
          role: 'user',
          authorName: 'You',
          content: 'Try again from here with a stricter checklist.',
          createdAt: TIMESTAMP,
        },
        {
          id: 'msg-4',
          role: 'assistant',
          authorName: 'Primary Agent',
          content: 'Here is the revised approach.',
          createdAt: TIMESTAMP,
        },
      ],
    });

    workspace.projects = [scratchpadProject];
    workspace.sessions = [originalSession];
    workspace.selectedProjectId = scratchpadProject.id;
    workspace.selectedPatternId = pattern.id;
    workspace.selectedSessionId = originalSession.id;

    const service = createService(workspace);

    const result = await service.branchSession(originalSession.id, 'msg-3');
    const branch = result.sessions[0];
    if (!branch) {
      throw new Error('Expected branchSession to prepend the branch.');
    }

    expect(branch.id).not.toBe(originalSession.id);
    expect(branch.cwd).toBe(join(USER_DATA_PATH, 'scratchpad', branch.id));
    expect(branch.cwd).not.toBe(originalSession.cwd);
    expect(branch.branchOrigin).toMatchObject({
      sourceSessionId: originalSession.id,
      sourceMessageId: 'msg-3',
      sourceMessageIndex: 2,
    });
    expect(branch.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(result.selectedSessionId).toBe(branch.id);
    expect(await pathExists(branch.cwd!)).toBe(true);
  });

  test('removes the scratchpad directory when deleting a session', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requireSinglePattern(workspace);
    const scratchpadProject = createScratchpadProject(join(USER_DATA_PATH, 'scratchpad'), TIMESTAMP);
    const sessionDirectory = join(USER_DATA_PATH, 'scratchpad', 'session-scratchpad');
    const session = createScratchpadSession(pattern.id, {
      cwd: sessionDirectory,
    });

    workspace.projects = [scratchpadProject];
    workspace.sessions = [session];
    workspace.selectedProjectId = scratchpadProject.id;
    workspace.selectedPatternId = pattern.id;
    workspace.selectedSessionId = session.id;

    const service = createService(workspace);
    await mkdir(sessionDirectory, { recursive: true });
    expect(await pathExists(sessionDirectory)).toBe(true);

    const result = await service.deleteSession(session.id);

    expect(result.sessions).toHaveLength(0);
    expect(await pathExists(sessionDirectory)).toBe(false);
  });
});
