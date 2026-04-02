import { describe, expect, test } from 'bun:test';

import {
  resolvePatternAgent,
  resolvePatternAgents,
  findWorkspaceAgentUsages,
  normalizeWorkspaceAgentDefinition,
  type WorkspaceAgentDefinition,
} from '@shared/domain/workspaceAgent';
import type { PatternAgentDefinition, PatternDefinition } from '@shared/domain/pattern';

const TIMESTAMP = '2026-04-01T00:00:00.000Z';

function makeWorkspaceAgent(overrides: Partial<WorkspaceAgentDefinition> = {}): WorkspaceAgentDefinition {
  return {
    id: 'wa-1',
    name: 'Code Reviewer',
    description: 'Reviews code for quality',
    instructions: 'Review all code carefully',
    model: 'gpt-5.4',
    reasoningEffort: 'high',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function makeInlineAgent(overrides: Partial<PatternAgentDefinition> = {}): PatternAgentDefinition {
  return {
    id: 'agent-1',
    name: 'Inline Agent',
    description: 'An inline agent',
    instructions: 'Do stuff',
    model: 'claude-sonnet-4',
    reasoningEffort: 'medium',
    ...overrides,
  };
}

function makeLinkedAgent(overrides: Partial<PatternAgentDefinition> = {}): PatternAgentDefinition {
  return {
    id: 'agent-linked',
    name: 'Code Reviewer',
    description: 'Reviews code for quality',
    instructions: 'Review all code carefully',
    model: 'gpt-5.4',
    reasoningEffort: 'high',
    workspaceAgentId: 'wa-1',
    ...overrides,
  };
}

function makePattern(agents: PatternAgentDefinition[], overrides: Partial<PatternDefinition> = {}): PatternDefinition {
  return {
    id: 'pattern-1',
    name: 'Test Pattern',
    description: '',
    mode: 'sequential',
    availability: 'available',
    maxIterations: 10,
    agents,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

describe('resolvePatternAgent', () => {
  const workspaceAgents = [makeWorkspaceAgent()];

  test('returns inline agent unchanged', () => {
    const agent = makeInlineAgent();
    const resolved = resolvePatternAgent(agent, workspaceAgents);
    expect(resolved).toEqual(agent);
  });

  test('resolves linked agent from workspace agent base', () => {
    const agent = makeLinkedAgent();
    const resolved = resolvePatternAgent(agent, workspaceAgents);
    expect(resolved.name).toBe('Code Reviewer');
    expect(resolved.model).toBe('gpt-5.4');
    expect(resolved.instructions).toBe('Review all code carefully');
    expect(resolved.workspaceAgentId).toBe('wa-1');
    expect(resolved.id).toBe('agent-linked');
  });

  test('applies per-pattern overrides on top of workspace agent', () => {
    const agent = makeLinkedAgent({
      overrides: { model: 'claude-opus-4', instructions: 'Override instructions' },
    });
    const resolved = resolvePatternAgent(agent, workspaceAgents);
    expect(resolved.model).toBe('claude-opus-4');
    expect(resolved.instructions).toBe('Override instructions');
    expect(resolved.name).toBe('Code Reviewer');
    expect(resolved.description).toBe('Reviews code for quality');
  });

  test('falls back to inline fields when workspace agent is missing', () => {
    const agent = makeLinkedAgent({ workspaceAgentId: 'nonexistent' });
    const resolved = resolvePatternAgent(agent, workspaceAgents);
    expect(resolved).toEqual(agent);
  });

  test('partial overrides only replace specified fields', () => {
    const agent = makeLinkedAgent({
      overrides: { name: 'Custom Name' },
    });
    const resolved = resolvePatternAgent(agent, workspaceAgents);
    expect(resolved.name).toBe('Custom Name');
    expect(resolved.model).toBe('gpt-5.4');
    expect(resolved.reasoningEffort).toBe('high');
  });
});

describe('resolvePatternAgents', () => {
  const workspaceAgents = [makeWorkspaceAgent()];

  test('resolves all agents in a pattern', () => {
    const pattern = makePattern([
      makeInlineAgent(),
      makeLinkedAgent(),
    ]);
    const resolved = resolvePatternAgents(pattern, workspaceAgents);
    expect(resolved.agents[0].name).toBe('Inline Agent');
    expect(resolved.agents[1].name).toBe('Code Reviewer');
    expect(resolved.agents[1].workspaceAgentId).toBe('wa-1');
  });

  test('preserves pattern metadata', () => {
    const pattern = makePattern([makeInlineAgent()], { id: 'p-custom', name: 'Custom' });
    const resolved = resolvePatternAgents(pattern, workspaceAgents);
    expect(resolved.id).toBe('p-custom');
    expect(resolved.name).toBe('Custom');
  });
});

describe('findWorkspaceAgentUsages', () => {
  test('finds patterns referencing a workspace agent', () => {
    const patterns = [
      makePattern([makeLinkedAgent()], { id: 'p1', name: 'Pattern 1' }),
      makePattern([makeInlineAgent()], { id: 'p2', name: 'Pattern 2' }),
      makePattern(
        [makeInlineAgent(), makeLinkedAgent({ id: 'agent-linked-2' })],
        { id: 'p3', name: 'Pattern 3' },
      ),
    ];
    const usages = findWorkspaceAgentUsages('wa-1', patterns);
    expect(usages).toHaveLength(2);
    expect(usages[0].patternId).toBe('p1');
    expect(usages[1].patternId).toBe('p3');
  });

  test('returns empty when no patterns reference the agent', () => {
    const patterns = [makePattern([makeInlineAgent()])];
    const usages = findWorkspaceAgentUsages('wa-1', patterns);
    expect(usages).toHaveLength(0);
  });
});

describe('normalizeWorkspaceAgentDefinition', () => {
  test('trims string fields', () => {
    const agent = makeWorkspaceAgent({
      name: '  Code Reviewer  ',
      description: '  Reviews code  ',
      instructions: '  Review carefully  ',
      model: '  gpt-5.4  ',
    });
    const normalized = normalizeWorkspaceAgentDefinition(agent);
    expect(normalized.name).toBe('Code Reviewer');
    expect(normalized.description).toBe('Reviews code');
    expect(normalized.instructions).toBe('Review carefully');
    expect(normalized.model).toBe('gpt-5.4');
  });

  test('preserves non-string fields', () => {
    const agent = makeWorkspaceAgent({ reasoningEffort: 'xhigh' });
    const normalized = normalizeWorkspaceAgentDefinition(agent);
    expect(normalized.reasoningEffort).toBe('xhigh');
    expect(normalized.id).toBe('wa-1');
    expect(normalized.createdAt).toBe(TIMESTAMP);
  });
});
