import { describe, expect, test } from 'bun:test';

import type { WorkflowDefinition } from '@shared/domain/workflow';
import {
  applySessionApprovalSettings,
  applySessionModelConfig,
  createSessionModelConfig,
  resolveSessionApprovalSettings,
  resolveSessionToolingSelection,
  resolveSessionTitle,
  resolveSessionModelConfig,
  type SessionRecord,
} from '@shared/domain/session';

function createWorkflow(): WorkflowDefinition {
  return {
    id: 'workflow-single',
    name: '1-on-1 Copilot Chat',
    description: 'Single agent chat',
    graph: {
      nodes: [
        { id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
        {
          id: 'agent-primary-node',
          kind: 'agent',
          label: 'Primary Agent',
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: 'agent-primary',
            name: 'Primary Agent',
            description: 'Helpful assistant',
            instructions: 'Help the user.',
            model: 'gpt-5.4',
            reasoningEffort: 'high',
          },
        },
        {
          id: 'agent-secondary-node',
          kind: 'agent',
          label: 'Secondary Agent',
          position: { x: 400, y: 0 },
          order: 1,
          config: {
            kind: 'agent',
            id: 'agent-secondary',
            name: 'Secondary Agent',
            description: 'Unused here',
            instructions: 'Review.',
            model: 'claude-sonnet-4.5',
            reasoningEffort: 'medium',
          },
        },
        { id: 'end', kind: 'end', label: 'End', position: { x: 600, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: 'edge-start-primary', source: 'start', target: 'agent-primary-node', kind: 'direct' },
        { id: 'edge-primary-secondary', source: 'agent-primary-node', target: 'agent-secondary-node', kind: 'direct' },
        { id: 'edge-secondary-end', source: 'agent-secondary-node', target: 'end', kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
      orchestrationMode: 'single',
      maxIterations: 1,
    },
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
  };
}

function createSession(overrides?: Partial<SessionRecord>): SessionRecord {
    return {
      id: 'session-1',
      projectId: 'project-scratchpad',
      workflowId: 'workflow-single',
    title: 'Scratchpad',
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    status: 'idle',
    messages: [],
    runs: [],
    ...overrides,
  };
}

describe('session model config helpers', () => {
  test('captures the initial model settings from the primary agent', () => {
    expect(createSessionModelConfig(createWorkflow())).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });
  });

  test('resolves persisted session overrides over the workflow defaults', () => {
    const config = resolveSessionModelConfig(
      createSession({
        sessionModelConfig: {
          model: 'claude-opus-4.5',
          reasoningEffort: 'medium',
        },
      }),
      createWorkflow(),
    );

    expect(config).toEqual({
      model: 'claude-opus-4.5',
      reasoningEffort: 'medium',
    });
  });

  test('applies session model settings only to the primary agent', () => {
    const workflow = createWorkflow();
    const updated = applySessionModelConfig(
      workflow,
      createSession({
        sessionModelConfig: {
          model: 'gpt-5.4-mini',
          reasoningEffort: 'low',
        },
      }),
    );

    const primaryAgent = updated.graph.nodes[1];
    const secondaryAgent = updated.graph.nodes[2];
    const originalSecondaryAgent = workflow.graph.nodes[2];
    expect(primaryAgent?.config.kind === 'agent' ? primaryAgent.config.model : undefined).toBe('gpt-5.4-mini');
    expect(primaryAgent?.config.kind === 'agent' ? primaryAgent.config.reasoningEffort : undefined).toBe('low');
    expect(secondaryAgent).toEqual(originalSecondaryAgent);
  });
});

describe('session title helpers', () => {
  test('keeps a manual title instead of recomputing it from the first user message', () => {
    const workflow = createWorkflow();
    const session = createSession({
      title: 'Release readiness review',
      titleSource: 'manual',
    });

    expect(
      resolveSessionTitle(session, workflow, [
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

  test('builds auto titles from markdown-heavy first messages', () => {
    const workflow = createWorkflow();
    const session = createSession();

    expect(
      resolveSessionTitle(session, workflow, [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: '```ts\nconst answer = 42;\n```',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ]),
    ).toBe('const answer = 42;');
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
  test('normalizes session approval overrides and applies them over workflow defaults', () => {
    const workflow = {
      ...createWorkflow(),
      settings: {
        ...createWorkflow().settings,
        approvalPolicy: {
          rules: [{ kind: 'tool-call' as const }],
          autoApprovedToolNames: ['git.status'],
        },
      },
    };

    expect(resolveSessionApprovalSettings(createSession())).toBeUndefined();
    expect(
        applySessionApprovalSettings(
          workflow,
          createSession({
          approvalSettings: {
            autoApprovedToolNames: ['git.diff', ' git.diff '],
          },
        }),
        ).settings.approvalPolicy,
    ).toEqual({
      rules: [{ kind: 'tool-call' }],
      autoApprovedToolNames: ['git.diff'],
    });
  });
});
