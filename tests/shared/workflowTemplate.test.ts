import { describe, expect, test } from 'bun:test';

import { createBuiltinPatterns } from '@shared/domain/pattern';
import {
  exportWorkflowDefinition,
  importWorkflowDefinition,
} from '@shared/domain/workflowSerialization';
import {
  buildWorkflowFromPattern,
  createBuiltinWorkflowTemplates,
} from '@shared/domain/workflowTemplate';
import { validateWorkflowDefinition } from '@shared/domain/workflow';

const TIMESTAMP = '2026-04-05T00:00:00.000Z';

function requirePattern(mode: 'sequential' | 'concurrent' | 'handoff' | 'group-chat') {
  const pattern = createBuiltinPatterns(TIMESTAMP).find((candidate) => candidate.mode === mode);
  if (!pattern) {
    throw new Error(`Expected built-in ${mode} pattern.`);
  }

  return pattern;
}

describe('workflow templates', () => {
  test('builds a valid sequential workflow from a pattern', () => {
    const workflow = buildWorkflowFromPattern(requirePattern('sequential'));

    expect(workflow.id).toBe('workflow-sequential-review');
    expect(workflow.graph.nodes.map((node) => node.kind)).toEqual(['start', 'agent', 'agent', 'agent', 'end']);
    expect(workflow.graph.edges.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`)).toEqual([
      'start->agent-node-agent-sequential-analyst:direct',
      'agent-node-agent-sequential-analyst->agent-node-agent-sequential-builder:direct',
      'agent-node-agent-sequential-builder->agent-node-agent-sequential-reviewer:direct',
      'agent-node-agent-sequential-reviewer->end:direct',
    ]);
    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('builds a valid concurrent workflow from a pattern', () => {
    const workflow = buildWorkflowFromPattern(requirePattern('concurrent'));

    expect(workflow.graph.edges.filter((edge) => edge.kind === 'fan-out')).toHaveLength(3);
    expect(workflow.graph.edges.filter((edge) => edge.kind === 'fan-in')).toHaveLength(3);
    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('builds a valid handoff workflow from a pattern graph', () => {
    const workflow = buildWorkflowFromPattern(requirePattern('handoff'));

    expect(workflow.graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain('start->agent-node-agent-handoff-triage');
    expect(workflow.graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain(
      'agent-node-agent-handoff-triage->agent-node-agent-handoff-ux',
    );
    expect(workflow.graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain(
      'agent-node-agent-handoff-runtime->agent-node-agent-handoff-triage',
    );
    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('builds a group-chat workflow with a loop approximation', () => {
    const workflow = buildWorkflowFromPattern(requirePattern('group-chat'));
    const loopEdge = workflow.graph.edges.find((edge) =>
      edge.source === 'agent-node-agent-group-reviewer' && edge.target === 'agent-node-agent-group-writer');
    const entryEdge = workflow.graph.edges.find((edge) =>
      edge.source === 'start' && edge.target === 'agent-node-agent-group-writer');
    const exitEdge = workflow.graph.edges.find((edge) =>
      edge.source === 'agent-node-agent-group-reviewer' && edge.target === 'end');

    expect(loopEdge).toEqual(expect.objectContaining({
      source: 'agent-node-agent-group-reviewer',
      target: 'agent-node-agent-group-writer',
      isLoop: true,
      maxIterations: 5,
      condition: { type: 'always' },
    }));
    expect(entryEdge?.isLoop).not.toBe(true);
    expect(exitEdge?.isLoop).not.toBe(true);
    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('generates built-in workflow templates for available patterns only', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);

    expect(templates.map((template) => template.id)).toEqual([
      'workflow-template-single',
      'workflow-template-sequential',
      'workflow-template-concurrent',
      'workflow-template-handoff',
      'workflow-template-group-chat',
    ]);
    expect(templates.every((template) => template.source === 'builtin')).toBe(true);
    expect(templates.every((template) => template.category === 'orchestration')).toBe(true);
  });

  test('round trips workflow yaml import and export', () => {
    const workflow = buildWorkflowFromPattern(requirePattern('sequential'));
    const exported = exportWorkflowDefinition(workflow, 'yaml');
    const imported = importWorkflowDefinition(exported.content, 'yaml');

    expect(exported.format).toBe('yaml');
    expect(imported).toEqual(workflow);
  });

  test('exports mermaid flowcharts with expected edges', () => {
    const workflow = buildWorkflowFromPattern(requirePattern('sequential'));
    const exported = exportWorkflowDefinition(workflow, 'mermaid');

    expect(exported.content.startsWith('flowchart LR')).toBe(true);
    expect(exported.content).toContain('-->');
    expect(exported.content).toContain('n0 --> n1');
  });
});
