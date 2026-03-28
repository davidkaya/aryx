import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createScratchpadProject } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-28T00:00:00.000Z';
const USER_DATA_PATH = 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures';

mock.module('electron', () => {
  const electronMock = {
    app: {
      getPath: () => USER_DATA_PATH,
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

const { WorkspaceRepository } = await import('@main/persistence/workspaceRepository');

function createStoredWorkspace(): WorkspaceState {
  const workspace = createWorkspaceSeed();
  const scratchpadProject = createScratchpadProject('C:\\legacy\\scratchpad', TIMESTAMP);
  const patternId = workspace.patterns[0]?.id;
  if (!patternId) {
    throw new Error('Expected workspace seed to include at least one pattern.');
  }

  const session: SessionRecord = {
    id: 'session-scratchpad',
    projectId: scratchpadProject.id,
    patternId,
    title: 'Scratchpad',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [],
    runs: [],
  };

  return {
    ...workspace,
    projects: [scratchpadProject],
    sessions: [session],
    selectedProjectId: scratchpadProject.id,
    selectedPatternId: patternId,
    selectedSessionId: session.id,
  };
}

beforeEach(async () => {
  await rm(join(USER_DATA_PATH, 'workspace.json'), { force: true });
  await rm(join(USER_DATA_PATH, 'scratchpad'), { recursive: true, force: true });
});

afterEach(async () => {
  await rm(join(USER_DATA_PATH, 'workspace.json'), { force: true });
  await rm(join(USER_DATA_PATH, 'scratchpad'), { recursive: true, force: true });
});

describe('WorkspaceRepository scratchpad migration', () => {
  test('assigns per-session scratchpad directories while loading existing workspace state', async () => {
    const workspaceFilePath = join(USER_DATA_PATH, 'workspace.json');
    await mkdir(USER_DATA_PATH, { recursive: true });
    await writeFile(workspaceFilePath, JSON.stringify(createStoredWorkspace(), null, 2), 'utf8');

    const repository = new WorkspaceRepository();
    const loaded = await repository.load();
    const loadedSession = loaded.sessions[0];
    if (!loadedSession) {
      throw new Error('Expected load() to return the migrated scratchpad session.');
    }

    const expectedScratchpadPath = join(USER_DATA_PATH, 'scratchpad');
    const expectedSessionPath = join(expectedScratchpadPath, loadedSession.id);

    expect(loaded.projects[0]?.path).toBe(expectedScratchpadPath);
    expect(loadedSession.cwd).toBe(expectedSessionPath);
    await access(expectedSessionPath);

    const persisted = JSON.parse(await readFile(workspaceFilePath, 'utf8')) as WorkspaceState;
    expect(persisted.sessions[0]?.cwd).toBe(expectedSessionPath);
  });

  test('strips runtime MCP probing state before persisting workspace data', async () => {
    const workspaceFilePath = join(USER_DATA_PATH, 'workspace.json');
    await mkdir(USER_DATA_PATH, { recursive: true });

    const repository = new WorkspaceRepository();
    const workspace = createStoredWorkspace();
    workspace.mcpProbingServerIds = ['server-a', 'server-b'];

    await repository.save(workspace);

    const persisted = JSON.parse(await readFile(workspaceFilePath, 'utf8')) as WorkspaceState;
    expect('mcpProbingServerIds' in persisted).toBe(false);
  });
});
