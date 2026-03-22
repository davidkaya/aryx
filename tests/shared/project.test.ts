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
    const project = createScratchpadProject('C:\\Users\\me\\AppData\\Roaming\\kopaya\\scratchpad');

    expect(project.id).toBe(SCRATCHPAD_PROJECT_ID);
    expect(project.name).toBe(SCRATCHPAD_PROJECT_NAME);
    expect(project.path).toContain('scratchpad');
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
      'C:\\Users\\me\\AppData\\Roaming\\kopaya\\scratchpad',
    );

    expect(merged[0].id).toBe(SCRATCHPAD_PROJECT_ID);
    expect(merged[1].id).toBe('project-a');
  });
});
