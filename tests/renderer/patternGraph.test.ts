import { describe, expect, test } from 'bun:test';

import { createBuiltinPatterns, resolvePatternGraph, type PatternDefinition } from '@shared/domain/pattern';
import {
  addHandoffEdge,
  findAgentForNode,
  isConnectionAllowed,
  removeEdge,
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
    expect(userInput!.type).toBe('systemNode');

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
});
