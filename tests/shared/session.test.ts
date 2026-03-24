import { describe, expect, test } from 'bun:test';

import type { PatternDefinition } from '@shared/domain/pattern';
import {
  applySessionApprovalSettings,
  applyScratchpadSessionConfig,
  createScratchpadSessionConfig,
  resolveSessionApprovalSettings,
  resolveSessionToolingSelection,
  resolveSessionTitle,
  resolveScratchpadSessionConfig,
  type SessionRecord,
} from '@shared/domain/session';

function createPattern(): PatternDefinition {
  return {
    id: 'pattern-single',
    name: '1-on-1 Copilot Chat',
    description: 'Single agent chat',
    mode: 'single',
    availability: 'available',
    maxIterations: 1,
    agents: [
      {
        id: 'agent-primary',
        name: 'Primary Agent',
        description: 'Helpful assistant',
        instructions: 'Help the user.',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      {
        id: 'agent-secondary',
        name: 'Secondary Agent',
        description: 'Unused here',
        instructions: 'Review.',
        model: 'claude-sonnet-4.5',
        reasoningEffort: 'medium',
      },
    ],
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
  };
}

function createSession(overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-1',
    projectId: 'project-scratchpad',
    patternId: 'pattern-single',
    title: 'Scratchpad',
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    status: 'idle',
    messages: [],
    runs: [],
    ...overrides,
  };
}

describe('scratchpad session config helpers', () => {
  test('captures the initial scratchpad model settings from the primary agent', () => {
    expect(createScratchpadSessionConfig(createPattern())).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });
  });

  test('resolves persisted scratchpad overrides over the pattern defaults', () => {
    const config = resolveScratchpadSessionConfig(
      createSession({
        scratchpadConfig: {
          model: 'claude-opus-4.5',
          reasoningEffort: 'medium',
        },
      }),
      createPattern(),
    );

    expect(config).toEqual({
      model: 'claude-opus-4.5',
      reasoningEffort: 'medium',
    });
  });

  test('applies scratchpad settings only to the primary agent', () => {
    const pattern = createPattern();
    const updated = applyScratchpadSessionConfig(
      pattern,
      createSession({
        scratchpadConfig: {
          model: 'gpt-5.4-mini',
          reasoningEffort: 'low',
        },
      }),
    );

    expect(updated.agents[0].model).toBe('gpt-5.4-mini');
    expect(updated.agents[0].reasoningEffort).toBe('low');
    expect(updated.agents[1]).toEqual(pattern.agents[1]);
  });
});

describe('session title helpers', () => {
  test('keeps a manual title instead of recomputing it from the first user message', () => {
    const pattern = createPattern();
    const session = createSession({
      title: 'Release readiness review',
      titleSource: 'manual',
    });

    expect(
      resolveSessionTitle(session, pattern, [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Investigate why the version badge keeps saying unknown after refresh.',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ]),
    ).toBe('Release readiness review');
  });
});

describe('session tooling helpers', () => {
  test('normalizes missing or duplicated tooling selections into stable arrays', () => {
    expect(resolveSessionToolingSelection(createSession())).toEqual({
      enabledMcpServerIds: [],
      enabledLspProfileIds: [],
    });

    expect(
      resolveSessionToolingSelection(
        createSession({
          tooling: {
            enabledMcpServerIds: ['mcp-git', ' mcp-git ', ''],
            enabledLspProfileIds: ['ts', ' ts ', ''],
          },
        }),
      ),
    ).toEqual({
      enabledMcpServerIds: ['mcp-git'],
      enabledLspProfileIds: ['ts'],
    });
  });
});

describe('session approval helpers', () => {
  test('normalizes session approval overrides and applies them over pattern defaults', () => {
    const pattern = {
      ...createPattern(),
      approvalPolicy: {
        rules: [{ kind: 'tool-call' as const }],
        autoApprovedToolNames: ['git.status'],
      },
    };

    expect(resolveSessionApprovalSettings(createSession())).toBeUndefined();
    expect(
      applySessionApprovalSettings(
        pattern,
        createSession({
          approvalSettings: {
            autoApprovedToolNames: ['git.diff', ' git.diff '],
          },
        }),
      ).approvalPolicy,
    ).toEqual({
      rules: [{ kind: 'tool-call' }],
      autoApprovedToolNames: ['git.diff'],
    });
  });
});
