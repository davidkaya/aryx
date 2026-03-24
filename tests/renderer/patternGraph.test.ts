import { describe, expect, test } from 'bun:test';

import { createBuiltinPatterns, resolvePatternGraph, type PatternDefinition } from '@shared/domain/pattern';
import {
  addAgentNodeToGraph,
  addHandoffEdge,
  autoLayoutGraph,
  canMoveSequential,
  findAgentForNode,
  isConnectionAllowed,
  isEdgeDeletionAllowed,
  removeEdge,
  swapSequentialOrder,
  toCanvasEdges,
  toCanvasNodes,
} from '@renderer/lib/patternGraph';

const BUILTIN_TIMESTAMP = '2026-03-22T00:00:00.000Z';
const patterns = createBuiltinPatterns(BUILTIN_TIMESTAMP);

function findPattern(mode: string): PatternDefinition {
  return patterns.find((p) => p.mode === mode)!;
}

describe('pattern graph view model', () => {
  test('projects sequential graph into canvas nodes with correct kinds and labels', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const nodes = toCanvasNodes(graph, pattern.agents);

    expect(nodes.length).toBe(pattern.agents.length + 2);

    const userInput = nodes.find((n) => n.data.kind === 'user-input');
    const userOutput = nodes.find((n) => n.data.kind === 'user-output');
    expect(userInput).toBeDefined();
    expect(userOutput).toBeDefined();
    expect(userInput!.data.readOnly).toBe(true);
    expect(userOutput!.data.readOnly).toBe(true);
    expect(userInput!.type).toBe('userInputNode');

    const agentNodes = nodes.filter((n) => n.data.kind === 'agent');
    expect(agentNodes.length).toBe(pattern.agents.length);
    expect(agentNodes[0]!.data.label).toBe(pattern.agents[0]!.name);
    expect(agentNodes[0]!.data.readOnly).toBe(false);
    expect(agentNodes[0]!.type).toBe('agentNode');
  });

  test('projects concurrent graph with distributor and collector system nodes', () => {
    const pattern = findPattern('concurrent');
    const graph = resolvePatternGraph(pattern);
    const nodes = toCanvasNodes(graph, pattern.agents);
    const edges = toCanvasEdges(graph, pattern.mode);

    const distributor = nodes.find((n) => n.data.kind === 'distributor');
    const collector = nodes.find((n) => n.data.kind === 'collector');
    expect(distributor).toBeDefined();
    expect(collector).toBeDefined();
    expect(distributor!.data.readOnly).toBe(true);
    expect(collector!.data.readOnly).toBe(true);

    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => !e.animated)).toBe(true);
  });

  test('handoff graph edges are animated', () => {
    const pattern = findPattern('handoff');
    const graph = resolvePatternGraph(pattern);
    const edges = toCanvasEdges(graph, pattern.mode);

    expect(edges.every((e) => e.animated)).toBe(true);
  });

  test('group chat graph includes orchestrator system node', () => {
    const pattern = findPattern('group-chat');
    const graph = resolvePatternGraph(pattern);
    const nodes = toCanvasNodes(graph, pattern.agents);

    const orchestrator = nodes.find((n) => n.data.kind === 'orchestrator');
    expect(orchestrator).toBeDefined();
    expect(orchestrator!.data.readOnly).toBe(true);
    expect(orchestrator!.data.label).toBe('Orchestrator');
  });

  test('findAgentForNode resolves agent from graph node id', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);

    const firstAgent = pattern.agents[0]!;
    const agent = findAgentForNode(`agent-node-${firstAgent.id}`, graph, pattern.agents);
    expect(agent).toBeDefined();
    expect(agent!.id).toBe(firstAgent.id);

    const noAgent = findAgentForNode('system-user-input', graph, pattern.agents);
    expect(noAgent).toBeUndefined();
  });
});

describe('pattern graph connection rules', () => {
  test('sequential mode disallows all new connections', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const agentNodes = graph.nodes.filter((n) => n.kind === 'agent');

    const allowed = isConnectionAllowed(
      { source: agentNodes[0]!.id, target: agentNodes[1]!.id, sourceHandle: null, targetHandle: null },
      'sequential',
      graph,
    );
    expect(allowed).toBe(false);
  });

  test('handoff mode allows agent-to-agent connections', () => {
    const pattern = findPattern('handoff');
    const graph = resolvePatternGraph(pattern);
    const agentNodes = graph.nodes.filter((n) => n.kind === 'agent');

    const allowed = isConnectionAllowed(
      { source: agentNodes[0]!.id, target: agentNodes[1]!.id, sourceHandle: null, targetHandle: null },
      'handoff',
      graph,
    );
    expect(allowed).toBe(true);
  });

  test('handoff mode blocks system-to-agent connections', () => {
    const pattern = findPattern('handoff');
    const graph = resolvePatternGraph(pattern);
    const inputNode = graph.nodes.find((n) => n.kind === 'user-input')!;
    const agentNode = graph.nodes.find((n) => n.kind === 'agent')!;

    const allowed = isConnectionAllowed(
      { source: inputNode.id, target: agentNode.id, sourceHandle: null, targetHandle: null },
      'handoff',
      graph,
    );
    expect(allowed).toBe(false);
  });

  test('concurrent mode disallows all new connections', () => {
    const pattern = findPattern('concurrent');
    const graph = resolvePatternGraph(pattern);
    const agentNodes = graph.nodes.filter((n) => n.kind === 'agent');

    const allowed = isConnectionAllowed(
      { source: agentNodes[0]!.id, target: agentNodes[1]!.id, sourceHandle: null, targetHandle: null },
      'concurrent',
      graph,
    );
    expect(allowed).toBe(false);
  });
});

describe('pattern graph mutation helpers', () => {
  test('addHandoffEdge adds a new edge between agent nodes', () => {
    const pattern = findPattern('handoff');
    const graph = resolvePatternGraph(pattern);
    const agentNodes = graph.nodes.filter((n) => n.kind === 'agent');
    const initialEdgeCount = graph.edges.length;

    const updated = addHandoffEdge(graph, agentNodes[1]!.id, agentNodes[2]!.id);
    expect(updated.edges.length).toBe(initialEdgeCount + 1);

    const duplicated = addHandoffEdge(updated, agentNodes[1]!.id, agentNodes[2]!.id);
    expect(duplicated.edges.length).toBe(initialEdgeCount + 1);
  });

  test('removeEdge removes an edge by id', () => {
    const pattern = findPattern('handoff');
    const graph = resolvePatternGraph(pattern);
    const firstEdge = graph.edges[0]!;

    const updated = removeEdge(graph, firstEdge.id);
    expect(updated.edges.length).toBe(graph.edges.length - 1);
    expect(updated.edges.find((e) => e.id === firstEdge.id)).toBeUndefined();
  });

  test('addAgentNodeToGraph places a disconnected agent node on the canvas', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const newAgent = { id: 'new-1', name: 'New Agent', description: '', instructions: '', model: 'gpt-5.4' };

    const updated = addAgentNodeToGraph(graph, newAgent);
    expect(updated.nodes.length).toBe(graph.nodes.length + 1);

    const newNode = updated.nodes.find((n) => n.agentId === 'new-1');
    expect(newNode).toBeDefined();
    expect(newNode!.kind).toBe('agent');

    // No new edges added — node is disconnected
    expect(updated.edges.length).toBe(graph.edges.length);
  });
});

describe('sequential reorder', () => {
  test('swapSequentialOrder swaps two adjacent agents and rebuilds edges', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const agentNodes = graph.nodes.filter((n) => n.kind === 'agent').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const firstId = agentNodes[0]!.id;
    const secondId = agentNodes[1]!.id;

    const swapped = swapSequentialOrder(graph, firstId, 'down');
    const newFirst = swapped.nodes.find((n) => n.id === firstId)!;
    const newSecond = swapped.nodes.find((n) => n.id === secondId)!;

    expect(newFirst.order).toBe(1);
    expect(newSecond.order).toBe(0);

    // Verify linear edges still form a valid chain
    const sortedAgents = swapped.nodes.filter((n) => n.kind === 'agent').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    expect(sortedAgents[0]!.id).toBe(secondId);
    expect(sortedAgents[1]!.id).toBe(firstId);
  });

  test('canMoveSequential respects boundary conditions', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const agentNodes = graph.nodes.filter((n) => n.kind === 'agent').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(canMoveSequential(graph, agentNodes[0]!.id, 'up')).toBe(false);
    expect(canMoveSequential(graph, agentNodes[0]!.id, 'down')).toBe(true);
    expect(canMoveSequential(graph, agentNodes[agentNodes.length - 1]!.id, 'down')).toBe(false);
    expect(canMoveSequential(graph, agentNodes[agentNodes.length - 1]!.id, 'up')).toBe(true);
  });
});

describe('edge deletion rules', () => {
  test('only handoff mode allows edge deletion', () => {
    expect(isEdgeDeletionAllowed('handoff')).toBe(true);
    expect(isEdgeDeletionAllowed('sequential')).toBe(false);
    expect(isEdgeDeletionAllowed('concurrent')).toBe(false);
    expect(isEdgeDeletionAllowed('group-chat')).toBe(false);
    expect(isEdgeDeletionAllowed('single')).toBe(false);
  });

  test('handoff canvas edges mark only agent-to-agent edges as deletable', () => {
    const pattern = findPattern('handoff');
    const graph = resolvePatternGraph(pattern);
    const edges = toCanvasEdges(graph, 'handoff');

    const deletableEdges = edges.filter((e) => e.deletable);
    const nonDeletableEdges = edges.filter((e) => !e.deletable);

    // Agent-to-agent edges should be deletable
    expect(deletableEdges.length).toBeGreaterThan(0);
    // Structural edges (user-input → triage, agent → user-output) should not
    expect(nonDeletableEdges.length).toBeGreaterThan(0);
  });

  test('user-input nodes use userInputNode type and user-output use userOutputNode type', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const nodes = toCanvasNodes(graph, pattern.agents);

    const inputNode = nodes.find((n) => n.data.kind === 'user-input');
    const outputNode = nodes.find((n) => n.data.kind === 'user-output');

    expect(inputNode!.type).toBe('userInputNode');
    expect(outputNode!.type).toBe('userOutputNode');
  });

  test('edges have directional arrow markers', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const edges = toCanvasEdges(graph, pattern.mode);

    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge.markerEnd).toBeDefined();
      expect((edge.markerEnd as { type: string }).type).toBe('arrowclosed');
    }
  });

  test('agent nodes include provider and model label when models catalog is provided', () => {
    const { modelCatalog } = require('@shared/domain/models');
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const nodes = toCanvasNodes(graph, pattern.agents, modelCatalog);

    const agentNodes = nodes.filter((n) => n.data.kind === 'agent');
    expect(agentNodes.length).toBeGreaterThan(0);

    for (const node of agentNodes) {
      expect(node.data.provider).toBeDefined();
      expect(node.data.modelLabel).toBeDefined();
      expect(node.data.modelLabel!.length).toBeGreaterThan(0);
    }
  });

  test('agent nodes infer provider from model id without models catalog', () => {
    const pattern = findPattern('sequential');
    const graph = resolvePatternGraph(pattern);
    const nodes = toCanvasNodes(graph, pattern.agents);

    const agentNodes = nodes.filter((n) => n.data.kind === 'agent');
    for (const node of agentNodes) {
      // Provider should still be inferred from model id prefix
      expect(node.data.provider).toBeDefined();
      // Without catalog, modelLabel falls back to the raw model id
      expect(node.data.modelLabel).toBeDefined();
    }
  });
});

describe('auto-layout', () => {
  test('autoLayoutGraph repositions nodes without changing edges', () => {
    const pattern = findPattern('handoff');
    const graph = resolvePatternGraph(pattern);
    const layouted = autoLayoutGraph(graph);

    expect(layouted.nodes.length).toBe(graph.nodes.length);
    expect(layouted.edges.length).toBe(graph.edges.length);
    expect(layouted.edges).toEqual(graph.edges);

    const positionsChanged = layouted.nodes.some((n, i) => {
      const orig = graph.nodes[i]!;
      return n.position.x !== orig.position.x || n.position.y !== orig.position.y;
    });
    expect(positionsChanged).toBe(true);
  });

  test('autoLayoutGraph produces finite positions for all modes', () => {
    for (const mode of ['sequential', 'concurrent', 'handoff', 'group-chat'] as const) {
      const pattern = findPattern(mode);
      const graph = resolvePatternGraph(pattern);
      const layouted = autoLayoutGraph(graph);

      expect(layouted.nodes.length).toBe(graph.nodes.length);
      for (const node of layouted.nodes) {
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
      }
    }
  });
});
