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

function createReferencedSubWorkflow(): WorkflowDefinition {
  return {
    id: 'child-workflow',
    name: 'Child Workflow',
    description: 'Nested child workflow.',
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
          id: 'agent-reviewer',
          kind: 'agent',
          label: 'Reviewer Agent',
          position: { x: 200, y: 0 },
          order: 0,
          config: {
            kind: 'agent',
            id: 'agent-reviewer',
            name: 'Reviewer Agent',
            description: 'Reviews the task.',
            instructions: 'Review the task.',
            model: 'gpt-5.4',
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
        { id: 'edge-start-reviewer', source: 'start', target: 'agent-reviewer', kind: 'direct' },
        { id: 'edge-reviewer-end', source: 'agent-reviewer', target: 'end', kind: 'direct' },
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

  test('accepts phase 4 executor node kinds as executable work', () => {
    const workflow = createWorkflow();
    workflow.graph.nodes[1] = {
      id: 'code-executor',
      kind: 'code-executor',
      label: 'Transform',
      position: { x: 100, y: 0 },
      config: {
        kind: 'code-executor',
        implementation: 'return-text:done',
      },
    };
    workflow.graph.edges[0] = { id: 'edge-start-code', source: 'start', target: 'code-executor', kind: 'direct' };
    workflow.graph.edges[1] = { id: 'edge-code-end', source: 'code-executor', target: 'end', kind: 'direct' };

    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('counts function and request port nodes as executable work', () => {
    const functionWorkflow = createWorkflow();
    functionWorkflow.graph.nodes[1] = {
      id: 'function-executor',
      kind: 'function-executor',
      label: 'Function',
      position: { x: 200, y: 0 },
      config: {
        kind: 'function-executor',
        functionRef: 'identity',
      },
    };
    functionWorkflow.graph.edges[0] = { id: 'edge-start-function', source: 'start', target: 'function-executor', kind: 'direct' };
    functionWorkflow.graph.edges[1] = { id: 'edge-function-end', source: 'function-executor', target: 'end', kind: 'direct' };

    const requestPortWorkflow = createWorkflow();
    requestPortWorkflow.graph.nodes[1] = {
      id: 'request-port',
      kind: 'request-port',
      label: 'Approval',
      position: { x: 200, y: 0 },
      config: {
        kind: 'request-port',
        portId: 'approval',
        requestType: 'Question',
        responseType: 'string',
      },
    };
    requestPortWorkflow.graph.edges[0] = { id: 'edge-start-port', source: 'start', target: 'request-port', kind: 'direct' };
    requestPortWorkflow.graph.edges[1] = { id: 'edge-port-end', source: 'request-port', target: 'end', kind: 'direct' };

    expect(validateWorkflowDefinition(functionWorkflow)).toEqual([]);
    expect(validateWorkflowDefinition(requestPortWorkflow)).toEqual([]);
  });

  test('rejects invalid phase 4 executor configs', () => {
    const codeWorkflow = createWorkflow();
    codeWorkflow.graph.nodes[1] = {
      id: 'code-executor',
      kind: 'code-executor',
      label: 'Code',
      position: { x: 200, y: 0 },
      config: {
        kind: 'code-executor',
        implementation: '   ',
      },
    };
    codeWorkflow.graph.edges[0] = { id: 'edge-start-code', source: 'start', target: 'code-executor', kind: 'direct' };
    codeWorkflow.graph.edges[1] = { id: 'edge-code-end', source: 'code-executor', target: 'end', kind: 'direct' };

    const functionWorkflow = createWorkflow();
    functionWorkflow.graph.nodes[1] = {
      id: 'function-executor',
      kind: 'function-executor',
      label: 'Function',
      position: { x: 200, y: 0 },
      config: {
        kind: 'function-executor',
        functionRef: '   ',
      },
    };
    functionWorkflow.graph.edges[0] = { id: 'edge-start-function', source: 'start', target: 'function-executor', kind: 'direct' };
    functionWorkflow.graph.edges[1] = { id: 'edge-function-end', source: 'function-executor', target: 'end', kind: 'direct' };

    const requestPortWorkflow = createWorkflow();
    requestPortWorkflow.graph.nodes[1] = {
      id: 'request-port',
      kind: 'request-port',
      label: 'Approval',
      position: { x: 200, y: 0 },
      config: {
        kind: 'request-port',
        portId: ' ',
        requestType: '',
        responseType: '   ',
      },
    };
    requestPortWorkflow.graph.edges[0] = { id: 'edge-start-port', source: 'start', target: 'request-port', kind: 'direct' };
    requestPortWorkflow.graph.edges[1] = { id: 'edge-port-end', source: 'request-port', target: 'end', kind: 'direct' };

    expect(validateWorkflowDefinition(codeWorkflow).some((issue) => issue.field === 'graph.nodes.config.implementation')).toBe(true);
    expect(validateWorkflowDefinition(functionWorkflow).some((issue) => issue.field === 'graph.nodes.config.functionRef')).toBe(true);

    const requestPortIssues = validateWorkflowDefinition(requestPortWorkflow);
    expect(requestPortIssues.some((issue) => issue.field === 'graph.nodes.config.portId')).toBe(true);
    expect(requestPortIssues.some((issue) => issue.field === 'graph.nodes.config.requestType')).toBe(true);
    expect(requestPortIssues.some((issue) => issue.field === 'graph.nodes.config.responseType')).toBe(true);
  });

  test('accepts sub-workflow nodes with inline workflows', () => {
    const inlineWorkflow = createReferencedSubWorkflow();
    const workflow = createWorkflow();
    workflow.graph.nodes[1] = {
      id: 'sub-workflow',
      kind: 'sub-workflow',
      label: 'Nested Workflow',
      position: { x: 200, y: 0 },
      config: {
        kind: 'sub-workflow',
        inlineWorkflow,
      },
    };
    workflow.graph.edges[0] = { id: 'edge-start-sub', source: 'start', target: 'sub-workflow', kind: 'direct' };
    workflow.graph.edges[1] = { id: 'edge-sub-end', source: 'sub-workflow', target: 'end', kind: 'direct' };

    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('rejects sub-workflow nodes without exactly one workflow source', () => {
    const workflow = createWorkflow();
    workflow.graph.nodes[1] = {
      id: 'sub-workflow',
      kind: 'sub-workflow',
      label: 'Nested Workflow',
      position: { x: 200, y: 0 },
      config: {
        kind: 'sub-workflow',
      },
    };
    workflow.graph.edges[0] = { id: 'edge-start-sub', source: 'start', target: 'sub-workflow', kind: 'direct' };
    workflow.graph.edges[1] = { id: 'edge-sub-end', source: 'sub-workflow', target: 'end', kind: 'direct' };

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.message.includes('exactly one of workflowId or inlineWorkflow'))).toBe(true);
  });

  test('builds a synthetic execution pattern from workflow agents', () => {
    const pattern = buildWorkflowExecutionPattern(createWorkflow());

    expect(pattern.id).toBe('workflow-1');
    expect(pattern.agents).toHaveLength(1);
    expect(pattern.agents[0]?.name).toBe('Primary Agent');
    expect(pattern.graph?.nodes.map((node) => node.kind)).toEqual(['user-input', 'agent', 'user-output']);
  });

  test('includes referenced sub-workflow agents when building execution patterns', () => {
    const childWorkflow = createReferencedSubWorkflow();
    const workflow = createWorkflow();
    workflow.graph.nodes[1] = {
      id: 'sub-workflow',
      kind: 'sub-workflow',
      label: 'Nested Workflow',
      position: { x: 200, y: 0 },
      config: {
        kind: 'sub-workflow',
        workflowId: childWorkflow.id,
      },
    };
    workflow.graph.edges[0] = { id: 'edge-start-sub', source: 'start', target: 'sub-workflow', kind: 'direct' };
    workflow.graph.edges[1] = { id: 'edge-sub-end', source: 'sub-workflow', target: 'end', kind: 'direct' };

    const pattern = buildWorkflowExecutionPattern(workflow, {
      resolveWorkflow: (workflowId) => workflowId === childWorkflow.id ? childWorkflow : undefined,
    });

    expect(pattern.mode).toBe('single');
    expect(pattern.agents.map((agent) => agent.id)).toEqual(['agent-reviewer']);
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
