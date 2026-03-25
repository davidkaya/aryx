import { describe, expect, test } from 'bun:test';

import {
  createBuiltinPatterns,
  resolvePatternGraph,
  syncPatternGraph,
  validatePatternDefinition,
} from '@shared/domain/pattern';

const BUILTIN_TIMESTAMP = '2026-03-22T00:00:00.000Z';

describe('pattern validation', () => {
  test('builtin patterns are valid except explicitly unavailable modes', () => {
    const patterns = createBuiltinPatterns(BUILTIN_TIMESTAMP);

    const validPatterns = patterns.filter((pattern) => pattern.availability !== 'unavailable');

    for (const pattern of validPatterns) {
      expect(validatePatternDefinition(pattern)).toEqual([]);
    }
  });

  test('builtin patterns require tool-call approval by default', () => {
    const patterns = createBuiltinPatterns(BUILTIN_TIMESTAMP);

    for (const pattern of patterns) {
      expect(pattern.approvalPolicy?.rules).toContainEqual({ kind: 'tool-call' });
    }
  });

  test('magentic pattern is marked unavailable', () => {
    const magentic = createBuiltinPatterns(BUILTIN_TIMESTAMP).find(
      (pattern) => pattern.mode === 'magentic',
    );

    expect(magentic).toBeDefined();
    expect(validatePatternDefinition(magentic!)[0]?.message).toContain('unsupported');
  });

  test('single-agent mode reports agent count, warning, and model issues together', () => {
    const singlePattern = createBuiltinPatterns(BUILTIN_TIMESTAMP).find(
      (pattern) => pattern.mode === 'single',
    );

    expect(singlePattern).toBeDefined();

    const issues = validatePatternDefinition({
      ...singlePattern!,
      agents: [
        {
          ...singlePattern!.agents[0],
          instructions: '   ',
        },
        {
          ...singlePattern!.agents[0],
          id: 'agent-reviewer',
          name: 'Reviewer',
          model: '',
        },
      ],
    });

    expect(issues.find((issue) => issue.field === 'agents')?.message).toBe(
      'Single-agent chat requires exactly one agent.',
    );
    expect(issues.find((issue) => issue.field === 'agents.instructions')?.level).toBe('warning');
    expect(issues.find((issue) => issue.field === 'agents.instructions')?.message).toBe(
      'Agent "Primary Agent" should have instructions.',
    );
    expect(issues.find((issue) => issue.field === 'agents.model')?.message).toBe(
      'Agent "Reviewer" requires a model identifier.',
    );
  });

  test('multi-agent orchestration modes reject single-agent configurations', () => {
    const patterns = createBuiltinPatterns(BUILTIN_TIMESTAMP);
    const handoff = patterns.find((pattern) => pattern.mode === 'handoff');
    const groupChat = patterns.find((pattern) => pattern.mode === 'group-chat');

    expect(handoff).toBeDefined();
    expect(groupChat).toBeDefined();

    expect(
      validatePatternDefinition({
        ...handoff!,
        agents: handoff!.agents.slice(0, 1),
      }).find((issue) => issue.field === 'agents')?.message,
    ).toBe('Handoff orchestration requires at least two agents.');

    expect(
      validatePatternDefinition({
        ...groupChat!,
        agents: groupChat!.agents.slice(0, 1),
      }).find((issue) => issue.field === 'agents')?.message,
    ).toBe('Group chat requires at least two agents.');
  });

  test('handoff builtin instructions clearly separate triage and specialist ownership', () => {
    const handoff = createBuiltinPatterns(BUILTIN_TIMESTAMP).find((pattern) => pattern.mode === 'handoff');

    expect(handoff).toBeDefined();
    expect(handoff?.agents[0].instructions).toContain('hand off before inspecting files');
    expect(handoff?.agents[0].instructions).toContain('Do not claim that you delegated');
    expect(handoff?.agents[1].instructions).toContain('own the substantive answer');
    expect(handoff?.agents[2].instructions).toContain('own the substantive answer');
  });

  test('group chat builtin instructions frame iterative drafting and review', () => {
    const groupChat = createBuiltinPatterns(BUILTIN_TIMESTAMP).find(
      (pattern) => pattern.mode === 'group-chat',
    );

    expect(groupChat).toBeDefined();
    expect(groupChat?.agents[0].instructions).toContain('refine your earlier draft');
    expect(groupChat?.agents[1].instructions).toContain('specific improvements');
    expect(groupChat?.agents[1].instructions).toContain('instead of restarting the conversation');
  });

  test('approval policy rejects unknown agent references', () => {
    const singlePattern = createBuiltinPatterns(BUILTIN_TIMESTAMP).find(
      (pattern) => pattern.mode === 'single',
    );

    expect(singlePattern).toBeDefined();

    const issues = validatePatternDefinition({
      ...singlePattern!,
      approvalPolicy: {
        rules: [
          {
            kind: 'tool-call',
            agentIds: ['agent-missing'],
          },
        ],
      },
    });

    expect(issues.find((issue) => issue.field === 'approvalPolicy')?.message).toBe(
      'Approval checkpoint "tool-call" references unknown agent "agent-missing".',
    );
  });

  test('approval policy rejects unknown auto-approved tool references when tool names are provided', () => {
    const singlePattern = createBuiltinPatterns(BUILTIN_TIMESTAMP).find(
      (pattern) => pattern.mode === 'single',
    );

    expect(singlePattern).toBeDefined();

    const issues = validatePatternDefinition({
      ...singlePattern!,
      approvalPolicy: {
        rules: [{ kind: 'tool-call' }],
        autoApprovedToolNames: ['web_fetch', 'unknown.tool'],
      },
    }, ['web_fetch']);

    expect(issues.find((issue) => issue.field === 'approvalPolicy')?.message).toBe(
      'Approval auto-approve references unknown tool "unknown.tool".',
    );
  });

  test('builtin patterns seed graph topology for each orchestration mode', () => {
    const patterns = createBuiltinPatterns(BUILTIN_TIMESTAMP);
    const single = patterns.find((pattern) => pattern.mode === 'single');
    const concurrent = patterns.find((pattern) => pattern.mode === 'concurrent');
    const handoff = patterns.find((pattern) => pattern.mode === 'handoff');
    const groupChat = patterns.find((pattern) => pattern.mode === 'group-chat');

    expect(single).toBeDefined();
    expect(concurrent).toBeDefined();
    expect(handoff).toBeDefined();
    expect(groupChat).toBeDefined();

    expect(resolvePatternGraph(single!).nodes.map((node) => node.kind)).toEqual([
      'user-input',
      'agent',
      'user-output',
    ]);

    expect(resolvePatternGraph(concurrent!).nodes.map((node) => node.kind)).toEqual([
      'user-input',
      'distributor',
      'agent',
      'agent',
      'agent',
      'collector',
      'user-output',
    ]);

    expect(resolvePatternGraph(handoff!).edges).toContainEqual(
      expect.objectContaining({
        source: 'system-user-input',
        target: 'agent-node-agent-handoff-triage',
      }),
    );
    expect(resolvePatternGraph(handoff!).edges).toContainEqual(
      expect.objectContaining({
        source: 'agent-node-agent-handoff-triage',
        target: 'agent-node-agent-handoff-ux',
      }),
    );

    expect(resolvePatternGraph(groupChat!).nodes.map((node) => node.kind)).toContain('orchestrator');
  });

  test('syncPatternGraph rebuilds sequential topology from the current agent list', () => {
    const sequential = createBuiltinPatterns(BUILTIN_TIMESTAMP).find(
      (pattern) => pattern.mode === 'sequential',
    );

    expect(sequential).toBeDefined();

    const updated = syncPatternGraph({
      ...sequential!,
      agents: [
        ...sequential!.agents,
        {
          id: 'agent-sequential-final',
          name: 'Final Reviewer',
          description: 'Adds a final pass.',
          instructions: 'Do a last review.',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
      ],
    });

    const graph = resolvePatternGraph(updated);
    expect(graph.nodes.filter((node) => node.kind === 'agent')).toHaveLength(4);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: 'agent-node-agent-sequential-reviewer',
        target: 'agent-node-agent-sequential-final',
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: 'agent-node-agent-sequential-final',
        target: 'system-user-output',
      }),
    );
  });

  test('graph validation rejects branched sequential topology', () => {
    const sequential = createBuiltinPatterns(BUILTIN_TIMESTAMP).find(
      (pattern) => pattern.mode === 'sequential',
    );

    expect(sequential).toBeDefined();

    const issues = validatePatternDefinition({
      ...sequential!,
      graph: {
        ...resolvePatternGraph(sequential!),
        edges: [
          ...resolvePatternGraph(sequential!).edges,
          {
            id: 'edge-system-user-input-to-agent-node-agent-sequential-builder-duplicate',
            source: 'system-user-input',
            target: 'agent-node-agent-sequential-builder',
          },
        ],
      },
    });

    expect(issues.find((issue) => issue.field === 'graph')?.message).toContain('single path');
  });
});
