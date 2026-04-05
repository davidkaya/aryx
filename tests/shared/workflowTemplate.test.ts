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

  test('creates 8 hand-crafted builtin workflow templates', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);

    expect(templates).toHaveLength(8);
    expect(templates.map((template) => template.id)).toEqual([
      'workflow-template-code-review',
      'workflow-template-research-summarize',
      'workflow-template-customer-support',
      'workflow-template-content-creation',
      'workflow-template-multi-agent-debate',
      'workflow-template-data-processing',
      'workflow-template-approval',
      'workflow-template-nested-orchestrator',
    ]);
    expect(templates.every((template) => template.source === 'builtin')).toBe(true);
  });

  test('builtin templates span all categories', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);
    const categories = new Set(templates.map((template) => template.category));

    expect(categories).toContain('orchestration');
    expect(categories).toContain('data-pipeline');
    expect(categories).toContain('human-in-loop');
  });

  test('builtin templates produce valid workflows', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);

    for (const template of templates) {
      const issues = validateWorkflowDefinition(template.workflow);
      expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
    }
  });

  test('builtin templates use the provided timestamp', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);

    for (const template of templates) {
      expect(template.createdAt).toBe(TIMESTAMP);
      expect(template.updatedAt).toBe(TIMESTAMP);
    }
  });

  test('research-summarize template uses fan-out and fan-in edges', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);
    const research = templates.find((t) => t.id === 'workflow-template-research-summarize')!;

    expect(research.workflow.graph.edges.filter((e) => e.kind === 'fan-out')).toHaveLength(3);
    expect(research.workflow.graph.edges.filter((e) => e.kind === 'fan-in')).toHaveLength(3);
  });

  test('content-creation template has a loop edge with maxIterations', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);
    const content = templates.find((t) => t.id === 'workflow-template-content-creation')!;
    const loopEdge = content.workflow.graph.edges.find((e) => e.isLoop && e.source === 'editor' && e.target === 'writer');

    expect(loopEdge).toBeDefined();
    expect(loopEdge!.maxIterations).toBe(3);
    expect(loopEdge!.source).toBe('editor');
    expect(loopEdge!.target).toBe('writer');
  });

  test('data-processing template includes invoke-function nodes', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);
    const dataProc = templates.find((t) => t.id === 'workflow-template-data-processing')!;
    const funcNodes = dataProc.workflow.graph.nodes.filter((n) => n.kind === 'invoke-function');

    expect(funcNodes).toHaveLength(2);
  });

  test('approval template includes a request-port node', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);
    const approval = templates.find((t) => t.id === 'workflow-template-approval')!;
    const portNode = approval.workflow.graph.nodes.find((n) => n.kind === 'request-port');

    expect(portNode).toBeDefined();
    expect(portNode!.config).toEqual(expect.objectContaining({
      kind: 'request-port',
      portId: 'review',
      requestType: 'ReviewRequest',
      responseType: 'ReviewDecision',
    }));
  });

  test('nested-orchestrator template includes a sub-workflow node', () => {
    const templates = createBuiltinWorkflowTemplates(TIMESTAMP);
    const nested = templates.find((t) => t.id === 'workflow-template-nested-orchestrator')!;
    const subNode = nested.workflow.graph.nodes.find((n) => n.kind === 'sub-workflow');

    expect(subNode).toBeDefined();
    expect(subNode!.config).toEqual(expect.objectContaining({ kind: 'sub-workflow' }));
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
