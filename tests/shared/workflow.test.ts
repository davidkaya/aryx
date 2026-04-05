import { describe, expect, test } from 'bun:test';

import {
  buildWorkflowExecutionPattern,
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from '@shared/domain/workflow';

const TIMESTAMP = '2026-04-05T00:00:00.000Z';

function createWorkflow(): WorkflowDefinition {
  return {
    id: 'workflow-1',
    name: 'Agent Workflow',
    description: 'A simple workflow.',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    graph: {
      nodes: [
        {
          id: 'start',
          kind: 'start',
          label: 'Start',
          position: { x: 0, y: 0 },
          config: { kind: 'start' },
        },
        {
          id: 'agent-primary',
          kind: 'agent',
          label: 'Primary Agent',
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: 'agent-primary',
            name: 'Primary Agent',
            description: 'Handles the task.',
            instructions: 'Do the work.',
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
          },
        },
        {
          id: 'end',
          kind: 'end',
          label: 'End',
          position: { x: 400, y: 0 },
          config: { kind: 'end' },
        },
      ],
      edges: [
        { id: 'edge-start-agent', source: 'start', target: 'agent-primary', kind: 'direct' },
        { id: 'edge-agent-end', source: 'agent-primary', target: 'end', kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
    },
  };
}

describe('workflow validation', () => {
  test('accepts a simple start-agent-end workflow', () => {
    expect(validateWorkflowDefinition(createWorkflow())).toEqual([]);
  });

  test('rejects unsupported node kinds in phase 1 backend', () => {
    const workflow = createWorkflow();
    workflow.graph.nodes.splice(1, 0, {
      id: 'request-port',
      kind: 'request-port',
      label: 'Approval',
      position: { x: 100, y: 0 },
      config: {
        kind: 'request-port',
        portId: 'approval',
        requestType: 'Question',
        responseType: 'Answer',
      },
    });

    expect(validateWorkflowDefinition(workflow).some((issue) =>
      issue.message.includes('not executable yet'))).toBe(true);
  });

  test('builds a synthetic execution pattern from workflow agents', () => {
    const pattern = buildWorkflowExecutionPattern(createWorkflow());

    expect(pattern.id).toBe('workflow-1');
    expect(pattern.agents).toHaveLength(1);
    expect(pattern.agents[0]?.name).toBe('Primary Agent');
    expect(pattern.graph?.nodes.map((node) => node.kind)).toEqual(['user-input', 'agent', 'user-output']);
  });

  test('accepts simple property and expression conditions', () => {
    const workflow = createWorkflow();
    workflow.graph.edges[0] = {
      ...workflow.graph.edges[0]!,
      condition: {
        type: 'property',
        combinator: 'and',
        rules: [
          {
            propertyPath: 'role',
            operator: 'equals',
            value: 'user',
          },
        ],
      },
    };
    workflow.graph.edges[1] = {
      ...workflow.graph.edges[1]!,
      condition: {
        type: 'expression',
        expression: 'role == "assistant" || role == "user"',
      },
    };

    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('rejects invalid condition operators and expressions', () => {
    const workflow = createWorkflow();
    workflow.graph.edges[0] = {
      ...workflow.graph.edges[0]!,
      condition: {
        type: 'property',
        rules: [
          {
            propertyPath: 'role',
            operator: 'bad-op' as 'equals',
            value: 'user',
          },
        ],
      },
    };
    workflow.graph.edges[1] = {
      ...workflow.graph.edges[1]!,
      condition: {
        type: 'expression',
        expression: 'role ~= "user"',
      },
    };

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.field === 'graph.edges.condition.rules.operator')).toBe(true);
    expect(issues.some((issue) => issue.field === 'graph.edges.condition.expression')).toBe(true);
  });

  test('rejects unmarked loop edges and requires termination metadata', () => {
    const workflow = createWorkflow();
    workflow.graph.edges.push({
      id: 'edge-agent-loop',
      source: 'agent-primary',
      target: 'agent-primary',
      kind: 'direct',
    });

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.field === 'graph.edges.isLoop')).toBe(true);
    expect(issues.some((issue) => issue.field === 'graph.edges.condition')).toBe(true);
    expect(issues.some((issue) => issue.field === 'graph.edges.maxIterations')).toBe(true);
  });

  test('accepts loop edges with condition, cap, and exit path', () => {
    const workflow = createWorkflow();
    workflow.graph.edges.push({
      id: 'edge-agent-loop',
      source: 'agent-primary',
      target: 'agent-primary',
      kind: 'direct',
      isLoop: true,
      maxIterations: 3,
      condition: {
        type: 'property',
        rules: [
          {
            propertyPath: 'iteration',
            operator: 'lt',
            value: '3',
          },
        ],
      },
    });

    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });
});
