import { describe, expect, test } from 'bun:test';

import { createWorkspaceSeed } from '@shared/domain/workspace';

describe('workspace seed', () => {
  test('starts empty and seeds the built-in orchestration patterns with a shared timestamp', () => {
    const workspace = createWorkspaceSeed();

    expect(workspace.projects).toEqual([]);
    expect(workspace.sessions).toEqual([]);
    expect(workspace.selectedProjectId).toBeUndefined();
    expect(workspace.selectedPatternId).toBeUndefined();
    expect(workspace.selectedSessionId).toBeUndefined();

    expect(workspace.patterns.map((pattern) => pattern.mode)).toEqual([
      'single',
      'sequential',
      'concurrent',
      'handoff',
      'group-chat',
      'magentic',
    ]);

    for (const pattern of workspace.patterns) {
      expect(pattern.createdAt).toBe(workspace.lastUpdatedAt);
      expect(pattern.updatedAt).toBe(workspace.lastUpdatedAt);
    }

    const magentic = workspace.patterns.find((pattern) => pattern.mode === 'magentic');

    expect(magentic?.availability).toBe('unavailable');
    expect(magentic?.unavailabilityReason).toContain('unsupported');
  });
});
