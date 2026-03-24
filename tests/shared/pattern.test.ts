import { describe, expect, test } from 'bun:test';

import { createBuiltinPatterns, validatePatternDefinition } from '@shared/domain/pattern';

const BUILTIN_TIMESTAMP = '2026-03-22T00:00:00.000Z';

describe('pattern validation', () => {
  test('builtin patterns are valid except explicitly unavailable modes', () => {
    const patterns = createBuiltinPatterns(BUILTIN_TIMESTAMP);

    const validPatterns = patterns.filter((pattern) => pattern.availability !== 'unavailable');

    for (const pattern of validPatterns) {
      expect(validatePatternDefinition(pattern)).toEqual([]);
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
    expect(handoff?.agents[0].instructions).toContain('Do not do the specialist work yourself');
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
});
