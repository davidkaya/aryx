import { describe, expect, test } from 'bun:test';

import {
  SCRATCHPAD_PROJECT_ID,
  SCRATCHPAD_PROJECT_NAME,
  createScratchpadProject,
  isScratchpadProject,
  mergeScratchpadProject,
} from '@shared/domain/project';

describe('scratchpad project helpers', () => {
  test('creates a stable built-in scratchpad project', () => {
    const project = createScratchpadProject('C:\\Users\\me\\AppData\\Roaming\\eryx\\scratchpad');

    expect(project.id).toBe(SCRATCHPAD_PROJECT_ID);
    expect(project.name).toBe(SCRATCHPAD_PROJECT_NAME);
    expect(project.path).toContain('scratchpad');
    expect(project.git).toBeUndefined();
  });

  test('recognizes scratchpad project ids and records', () => {
    expect(isScratchpadProject(SCRATCHPAD_PROJECT_ID)).toBe(true);
    expect(
      isScratchpadProject({
        id: SCRATCHPAD_PROJECT_ID,
      }),
    ).toBe(true);
    expect(isScratchpadProject('project-normal')).toBe(false);
  });

  test('merges scratchpad project ahead of normal user projects and preserves user projects', () => {
    const merged = mergeScratchpadProject(
      [
        {
          id: 'project-a',
          name: 'Repo A',
          path: 'C:\\repo-a',
          addedAt: '2026-03-23T00:00:00.000Z',
        },
      ],
      'C:\\Users\\me\\AppData\\Roaming\\eryx\\scratchpad',
    );

    expect(merged[0].id).toBe(SCRATCHPAD_PROJECT_ID);
    expect(merged[1].id).toBe('project-a');
  });

  test('preserves git context on non-scratchpad projects when merging scratchpad project', () => {
    const merged = mergeScratchpadProject(
      [
        {
          id: 'project-a',
          name: 'Repo A',
          path: 'C:\\repo-a',
          addedAt: '2026-03-23T00:00:00.000Z',
          git: {
            status: 'ready',
            scannedAt: '2026-03-23T00:05:00.000Z',
            repoRoot: 'C:\\repo-a',
            branch: 'main',
            isDirty: true,
            changedFileCount: 2,
            changes: {
              staged: 1,
              unstaged: 1,
              untracked: 0,
              conflicted: 0,
            },
          },
        },
      ],
      'C:\\Users\\me\\AppData\\Roaming\\eryx\\scratchpad',
    );

    expect(merged[0].git).toBeUndefined();
    expect(merged[1].git).toEqual({
      status: 'ready',
      scannedAt: '2026-03-23T00:05:00.000Z',
      repoRoot: 'C:\\repo-a',
      branch: 'main',
      isDirty: true,
      changedFileCount: 2,
      changes: {
        staged: 1,
        unstaged: 1,
        untracked: 0,
        conflicted: 0,
      },
    });
  });
});
