import { describe, expect, test } from 'bun:test';

import {
  buildWorkflowExecutionDefinition,
  createBuiltinWorkflows,
  createDefaultModeSettings,
  isBuilderBasedMode,
  isGraphBasedMode,
  normalizeWorkflowDefinition,
  scaffoldGraphForMode,
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowNode,
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
      id: 'invoke-function',
      kind: 'invoke-function',
      label: 'Function Tool',
      position: { x: 100, y: 0 },
      config: {
        kind: 'invoke-function',
        functionName: 'GetUserData',
      },
    };
    workflow.graph.edges[0] = { id: 'edge-start-fn', source: 'start', target: 'invoke-function', kind: 'direct' };
    workflow.graph.edges[1] = { id: 'edge-fn-end', source: 'invoke-function', target: 'end', kind: 'direct' };

    expect(validateWorkflowDefinition(workflow)).toEqual([]);
  });

  test('counts function and request port nodes as executable work', () => {
    const functionWorkflow = createWorkflow();
    functionWorkflow.graph.nodes[1] = {
      id: 'invoke-function',
      kind: 'invoke-function',
      label: 'Function Tool',
      position: { x: 200, y: 0 },
      config: {
        kind: 'invoke-function',
        functionName: 'identity',
      },
    };
    functionWorkflow.graph.edges[0] = { id: 'edge-start-function', source: 'start', target: 'invoke-function', kind: 'direct' };
    functionWorkflow.graph.edges[1] = { id: 'edge-function-end', source: 'invoke-function', target: 'end', kind: 'direct' };

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
    const functionWorkflow = createWorkflow();
    functionWorkflow.graph.nodes[1] = {
      id: 'invoke-function',
      kind: 'invoke-function',
      label: 'Function Tool',
      position: { x: 200, y: 0 },
      config: {
        kind: 'invoke-function',
        functionName: '   ',
      },
    };
    functionWorkflow.graph.edges[0] = { id: 'edge-start-function', source: 'start', target: 'invoke-function', kind: 'direct' };
    functionWorkflow.graph.edges[1] = { id: 'edge-function-end', source: 'invoke-function', target: 'end', kind: 'direct' };

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

    expect(validateWorkflowDefinition(functionWorkflow).some((issue) => issue.field === 'graph.nodes.config.functionName')).toBe(true);

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

  test('builds an execution definition from workflow agents', () => {
    const execution = buildWorkflowExecutionDefinition(createWorkflow());

    expect(execution.id).toBe('workflow-1');
    expect(execution.agents).toHaveLength(1);
    expect(execution.agents[0]?.name).toBe('Primary Agent');
    expect(execution.orchestrationMode).toBe('single');
  });

  test('includes referenced sub-workflow agents when building execution definitions', () => {
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

    const execution = buildWorkflowExecutionDefinition(workflow, {
      resolveWorkflow: (workflowId: string) => workflowId === childWorkflow.id ? childWorkflow : undefined,
    });

    expect(execution.orchestrationMode).toBe('single');
    expect(execution.agents.map((agent) => agent.id)).toEqual(['agent-reviewer']);
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

  test('creates default mode settings for builder-based modes', () => {
    expect(createDefaultModeSettings()).toBeUndefined();
    expect(createDefaultModeSettings('single')).toBeUndefined();
    expect(createDefaultModeSettings('handoff')).toEqual({
      handoff: {
        toolCallFiltering: 'handoff-only',
        returnToPrevious: false,
      },
    });
    expect(createDefaultModeSettings('group-chat')).toEqual({
      groupChat: {
        selectionStrategy: 'round-robin',
        maxRounds: 5,
      },
    });
  });

  test('identifies graph-based and builder-based orchestration modes', () => {
    expect(isGraphBasedMode('single')).toBe(true);
    expect(isGraphBasedMode('sequential')).toBe(true);
    expect(isGraphBasedMode('concurrent')).toBe(true);
    expect(isGraphBasedMode('handoff')).toBe(false);
    expect(isBuilderBasedMode('handoff')).toBe(true);
    expect(isBuilderBasedMode('group-chat')).toBe(true);
    expect(isBuilderBasedMode('single')).toBe(false);
  });

  test('scaffolds single mode while preserving the provided agent node', () => {
    const agentNode = createWorkflow().graph.nodes[1] as WorkflowNode;
    const graph = scaffoldGraphForMode('single', [agentNode]);

    expect(graph.nodes.map((node) => node.id)).toEqual(['start', 'agent-primary', 'end']);
    expect(graph.edges.map((edge) => edge.kind)).toEqual(['direct', 'direct']);
    expect(graph.nodes[1]?.config.kind).toBe('agent');
    expect(graph.nodes[1]?.config.kind === 'agent' ? graph.nodes[1].config.name : '').toBe('Primary Agent');
  });

  test('scaffolds concurrent mode with fan-out and fan-in edges', () => {
    const graph = scaffoldGraphForMode('concurrent');

    expect(graph.nodes[0]?.id).toBe('start');
    expect(graph.nodes.at(-1)?.id).toBe('end');
    expect(graph.edges.filter((edge) => edge.kind === 'fan-out')).toHaveLength(2);
    expect(graph.edges.filter((edge) => edge.kind === 'fan-in')).toHaveLength(2);
  });

  test('scaffolds handoff mode with triage and specialist return loops', () => {
    const graph = scaffoldGraphForMode('handoff');
    const loopEdges = graph.edges.filter((edge) => edge.isLoop);

    expect(graph.nodes.map((node) => node.id)).toContain('agent-handoff-triage');
    // Both forward (triage→specialist) and return (specialist→triage) edges are loops
    expect(loopEdges).toHaveLength(2);
    expect(loopEdges.every((edge) => edge.maxIterations === 4)).toBe(true);
    expect(loopEdges.every((edge) => edge.condition?.type === 'always')).toBe(true);
  });

  test('scaffolds group-chat mode with loop edges between agent nodes', () => {
    const graph = scaffoldGraphForMode('group-chat');
    const loopEdges = graph.edges.filter((edge) => edge.isLoop);

    expect(loopEdges.length).toBeGreaterThanOrEqual(2);
    expect(loopEdges.every((edge) => edge.condition?.type === 'always')).toBe(true);
  });

  test('normalizes mode settings for builder-based workflows', () => {
    const workflow = createWorkflow();
    workflow.settings.orchestrationMode = 'handoff';
    workflow.settings.modeSettings = {
      handoff: {
        toolCallFiltering: 'all',
        returnToPrevious: true,
        handoffInstructions: '  Delegate carefully.  ',
        triageAgentNodeId: '  agent-primary  ',
      },
    };

    const normalized = normalizeWorkflowDefinition(workflow);

    expect(normalized.settings.modeSettings).toEqual({
      handoff: {
        toolCallFiltering: 'all',
        returnToPrevious: true,
        handoffInstructions: 'Delegate carefully.',
        triageAgentNodeId: 'agent-primary',
      },
    });
  });

  test('rejects single mode graphs that use multiple agents or fan edges', () => {
    const workflow = createWorkflow();
    workflow.settings.orchestrationMode = 'single';
    workflow.graph.nodes.splice(2, 0, {
      id: 'agent-secondary',
      kind: 'agent',
      label: 'Secondary Agent',
      position: { x: 320, y: 120 },
      order: 1,
      config: {
        kind: 'agent',
        id: 'agent-secondary',
        name: 'Secondary Agent',
        description: 'Handles backup work.',
        instructions: 'Assist the primary agent.',
        model: 'gpt-5.4',
      },
    });
    workflow.graph.edges = [
      { id: 'edge-start-primary', source: 'start', target: 'agent-primary', kind: 'fan-out', fanOutConfig: { strategy: 'broadcast' } },
      { id: 'edge-start-secondary', source: 'start', target: 'agent-secondary', kind: 'fan-out', fanOutConfig: { strategy: 'broadcast' } },
      { id: 'edge-primary-end', source: 'agent-primary', target: 'end', kind: 'fan-in' },
      { id: 'edge-secondary-end', source: 'agent-secondary', target: 'end', kind: 'fan-in' },
    ];

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.message.includes('Single mode requires exactly one agent node'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('Single mode does not support fan-out or fan-in edges'))).toBe(true);
  });

  test('warns when sequential mode is not shaped like a linear graph', () => {
    const workflow = createWorkflow();
    workflow.settings.orchestrationMode = 'sequential';
    workflow.graph.nodes.splice(2, 0, {
      id: 'agent-secondary',
      kind: 'agent',
      label: 'Secondary Agent',
      position: { x: 220, y: 120 },
      order: 1,
      config: {
        kind: 'agent',
        id: 'agent-secondary',
        name: 'Secondary Agent',
        description: 'Handles follow-up work.',
        instructions: 'Follow up.',
        model: 'gpt-5.4',
      },
    });
    workflow.graph.edges = [
      { id: 'edge-start-primary', source: 'start', target: 'agent-primary', kind: 'direct' },
      { id: 'edge-start-secondary', source: 'start', target: 'agent-secondary', kind: 'direct' },
      { id: 'edge-primary-end', source: 'agent-primary', target: 'end', kind: 'direct' },
      { id: 'edge-secondary-end', source: 'agent-secondary', target: 'end', kind: 'direct' },
    ];

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.level === 'warning' && issue.message.includes('Sequential mode works best with a linear'))).toBe(true);
  });

  test('requires concurrent mode fan edges and warns when branches do not rejoin', () => {
    const workflow = createWorkflow();
    workflow.settings.orchestrationMode = 'concurrent';
    workflow.graph.nodes.splice(2, 0, {
      id: 'agent-secondary',
      kind: 'agent',
      label: 'Secondary Agent',
      position: { x: 220, y: 120 },
      order: 1,
      config: {
        kind: 'agent',
        id: 'agent-secondary',
        name: 'Secondary Agent',
        description: 'Handles alternate work.',
        instructions: 'Assist in parallel.',
        model: 'gpt-5.4',
      },
    });
    workflow.graph.edges = [
      { id: 'edge-start-primary', source: 'start', target: 'agent-primary', kind: 'fan-out', fanOutConfig: { strategy: 'broadcast' } },
      { id: 'edge-start-secondary', source: 'start', target: 'agent-secondary', kind: 'fan-out', fanOutConfig: { strategy: 'broadcast' } },
      { id: 'edge-primary-end', source: 'agent-primary', target: 'end', kind: 'fan-in' },
      { id: 'edge-secondary-primary', source: 'agent-secondary', target: 'agent-primary', kind: 'direct' },
    ];

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.level === 'warning' && issue.message.includes('rejoins through a matching fan-in edge'))).toBe(true);
  });

  test('validates handoff triage settings and specialist return paths', () => {
    const workflow = createWorkflow();
    workflow.settings.orchestrationMode = 'handoff';
    workflow.settings.modeSettings = {
      handoff: {
        toolCallFiltering: 'handoff-only',
        returnToPrevious: false,
        triageAgentNodeId: 'missing-triage',
      },
    };
    workflow.graph.nodes.splice(2, 0, {
      id: 'agent-specialist',
      kind: 'agent',
      label: 'Specialist',
      position: { x: 420, y: 120 },
      order: 1,
      config: {
        kind: 'agent',
        id: 'agent-specialist',
        name: 'Specialist',
        description: 'Handles specialist work.',
        instructions: 'Own the specialist response.',
        model: 'gpt-5.4',
      },
    });
    workflow.graph.edges = [
      { id: 'edge-start-triage', source: 'start', target: 'agent-primary', kind: 'direct' },
      { id: 'edge-specialist-end', source: 'agent-specialist', target: 'end', kind: 'direct' },
      { id: 'edge-triage-end', source: 'agent-primary', target: 'end', kind: 'direct' },
    ];

    const invalidTriageIssues = validateWorkflowDefinition(workflow);
    expect(invalidTriageIssues.some((issue) => issue.field === 'settings.modeSettings.handoff.triageAgentNodeId')).toBe(true);

    workflow.settings.modeSettings = {
      handoff: {
        toolCallFiltering: 'handoff-only',
        returnToPrevious: false,
        triageAgentNodeId: 'agent-primary',
      },
    };

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.level === 'warning' && issue.message.includes('triage agent has outgoing edges to specialist agents'))).toBe(true);
    expect(issues.some((issue) => issue.level === 'warning' && issue.message.includes('should have a return path back to the triage agent'))).toBe(true);
  });

  test('warns when group-chat mode does not create a loop among agents', () => {
    const workflow = createWorkflow();
    workflow.settings.orchestrationMode = 'group-chat';
    workflow.graph.nodes.splice(2, 0, {
      id: 'agent-reviewer',
      kind: 'agent',
      label: 'Reviewer',
      position: { x: 420, y: 0 },
      order: 1,
      config: {
        kind: 'agent',
        id: 'agent-reviewer',
        name: 'Reviewer',
        description: 'Reviews drafts.',
        instructions: 'Review and refine.',
        model: 'gpt-5.4',
      },
    });
    workflow.graph.edges = [
      { id: 'edge-start-writer', source: 'start', target: 'agent-primary', kind: 'direct' },
      { id: 'edge-writer-reviewer', source: 'agent-primary', target: 'agent-reviewer', kind: 'direct' },
      { id: 'edge-reviewer-end', source: 'agent-reviewer', target: 'end', kind: 'direct' },
    ];

    const issues = validateWorkflowDefinition(workflow);
    expect(issues.some((issue) => issue.level === 'warning' && issue.message.includes('form a loop for repeated turns'))).toBe(true);
  });

  test('builtin handoff and group-chat workflows include mode settings defaults', () => {
    const builtinWorkflows = createBuiltinWorkflows(TIMESTAMP);
    const handoffWorkflow = builtinWorkflows.find((workflow) => workflow.settings.orchestrationMode === 'handoff');
    const groupChatWorkflow = builtinWorkflows.find((workflow) => workflow.settings.orchestrationMode === 'group-chat');

    expect(handoffWorkflow?.settings.modeSettings).toEqual(createDefaultModeSettings('handoff'));
    expect(groupChatWorkflow?.settings.modeSettings).toEqual(createDefaultModeSettings('group-chat'));
  });
});

describe('built-in workflow consistency', () => {
  const builtinWorkflows = createBuiltinWorkflows(TIMESTAMP);

  test('all built-in workflows pass validation without errors', () => {
    for (const workflow of builtinWorkflows) {
      const issues = validateWorkflowDefinition(workflow);
      const errors = issues.filter((i) => i.level === 'error');
      expect(errors).toEqual([]);
    }
  });

  test('all built-in workflows are stable under normalization', () => {
    for (const workflow of builtinWorkflows) {
      const normalized = normalizeWorkflowDefinition(workflow);
      expect(normalized.graph.edges).toEqual(workflow.graph.edges);
      expect(normalized.settings).toEqual(workflow.settings);
    }
  });

  test('group-chat workflow has consistent maxIterations across settings and edges', () => {
    const workflow = builtinWorkflows.find((w) => w.settings.orchestrationMode === 'group-chat')!;
    const maxRounds = workflow.settings.modeSettings!.groupChat!.maxRounds;
    const maxIterations = workflow.settings.maxIterations;

    expect(maxIterations).toBeDefined();
    expect(maxRounds).toBe(maxIterations!);

    const loopEdges = workflow.graph.edges.filter((e) => e.isLoop);
    expect(loopEdges.length).toBeGreaterThan(0);
    for (const edge of loopEdges) {
      expect(edge.maxIterations).toBe(maxRounds);
    }
  });

  test('handoff workflow has consistent maxIterations across settings and edges', () => {
    const workflow = builtinWorkflows.find((w) => w.settings.orchestrationMode === 'handoff')!;
    const maxIterations = workflow.settings.maxIterations;

    const loopEdges = workflow.graph.edges.filter((e) => e.isLoop);
    expect(loopEdges.length).toBeGreaterThan(0);
    for (const edge of loopEdges) {
      expect(edge.maxIterations).toBe(maxIterations);
    }
  });

  test('scaffoldGraphForMode respects provided settings for group-chat', () => {
    const graph = scaffoldGraphForMode('group-chat', {
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
        orchestrationMode: 'group-chat',
        modeSettings: { groupChat: { selectionStrategy: 'round-robin', maxRounds: 12 } },
        maxIterations: 12,
      },
    });

    const loopEdges = graph.edges.filter((e) => e.isLoop);
    expect(loopEdges.length).toBeGreaterThan(0);
    for (const edge of loopEdges) {
      expect(edge.maxIterations).toBe(12);
    }
  });

  test('scaffoldGraphForMode respects provided settings for handoff', () => {
    const graph = scaffoldGraphForMode('handoff', {
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
        orchestrationMode: 'handoff',
        maxIterations: 8,
      },
    });

    const loopEdges = graph.edges.filter((e) => e.isLoop);
    expect(loopEdges.length).toBeGreaterThan(0);
    for (const edge of loopEdges) {
      expect(edge.maxIterations).toBe(8);
    }
  });

  test('normalizeWorkflowDefinition syncs loop edge maxIterations for group-chat', () => {
    const workflow = createBuiltinWorkflows(TIMESTAMP).find((w) => w.settings.orchestrationMode === 'group-chat')!;
    const modified: WorkflowDefinition = {
      ...workflow,
      settings: {
        ...workflow.settings,
        maxIterations: 10,
        modeSettings: {
          groupChat: { selectionStrategy: 'round-robin', maxRounds: 10 },
        },
      },
    };

    const normalized = normalizeWorkflowDefinition(modified);
    const loopEdges = normalized.graph.edges.filter((e) => e.isLoop);
    for (const edge of loopEdges) {
      expect(edge.maxIterations).toBe(10);
    }
  });

  test('normalizeWorkflowDefinition does not modify loop edges for graph-based modes', () => {
    const workflow = createBuiltinWorkflows(TIMESTAMP).find((w) => w.settings.orchestrationMode === 'sequential')!;
    const normalized = normalizeWorkflowDefinition(workflow);
    expect(normalized.graph.edges).toEqual(workflow.graph.edges);
  });
});
