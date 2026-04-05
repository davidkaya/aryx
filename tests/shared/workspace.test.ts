import { describe, expect, test } from 'bun:test';

import { createWorkspaceSeed } from '@shared/domain/workspace';

describe('workspace seed', () => {
  test('starts empty and seeds built-in patterns and workflow templates with a shared timestamp', () => {
    const workspace = createWorkspaceSeed();

    expect(workspace.projects).toEqual([]);
    expect(workspace.sessions).toEqual([]);
    expect(workspace.settings).toEqual({
      theme: 'dark',
      tooling: {
        mcpServers: [],
        lspProfiles: [],
      },
      discoveredUserTooling: {
        mcpServers: [],
      },
    });
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
    expect(workspace.workflowTemplates.map((template) => template.id)).toEqual([
      'workflow-template-single',
      'workflow-template-sequential',
      'workflow-template-concurrent',
      'workflow-template-handoff',
      'workflow-template-group-chat',
    ]);

    for (const pattern of workspace.patterns) {
      expect(pattern.createdAt).toBe(workspace.lastUpdatedAt);
      expect(pattern.updatedAt).toBe(workspace.lastUpdatedAt);
      expect(pattern.approvalPolicy?.rules).toContainEqual({ kind: 'tool-call' });
    }

    const magentic = workspace.patterns.find((pattern) => pattern.mode === 'magentic');

    expect(magentic?.availability).toBe('unavailable');
    expect(magentic?.unavailabilityReason).toContain('unsupported');
    for (const template of workspace.workflowTemplates) {
      expect(template.createdAt).toBe(workspace.lastUpdatedAt);
      expect(template.updatedAt).toBe(workspace.lastUpdatedAt);
    }
  });
});
