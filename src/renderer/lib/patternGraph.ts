import type { Node, Edge, Connection } from '@xyflow/react';

import type {
  OrchestrationMode,
  PatternAgentDefinition,
  PatternDefinition,
  PatternGraph,
  PatternGraphEdge,
  PatternGraphNode,
  PatternGraphNodeKind,
} from '@shared/domain/pattern';
import { resolvePatternGraph } from '@shared/domain/pattern';

/* ── Canvas node data ──────────────────────────────────────── */

export interface GraphNodeData extends Record<string, unknown> {
  label: string;
  kind: PatternGraphNodeKind;
  agentId?: string;
  order?: number;
  readOnly: boolean;
}

/* ── View-model projection ─────────────────────────────────── */

const SYSTEM_NODE_LABELS: Partial<Record<PatternGraphNodeKind, string>> = {
  'user-input': 'User Input',
  'user-output': 'User Output',
  distributor: 'Distributor',
  collector: 'Collector',
  orchestrator: 'Orchestrator',
};

function isSystemNode(kind: PatternGraphNodeKind): boolean {
  return kind !== 'agent';
}

function resolveNodeLabel(node: PatternGraphNode, agents: PatternAgentDefinition[]): string {
  if (node.kind === 'agent' && node.agentId) {
    const agent = agents.find((a) => a.id === node.agentId);
    return agent?.name || node.agentId;
  }

  return SYSTEM_NODE_LABELS[node.kind] ?? node.kind;
}

function resolveNodeType(kind: PatternGraphNodeKind): string {
  if (kind === 'agent') {
    return 'agentNode';
  }

  return 'systemNode';
}

export function toCanvasNodes(graph: PatternGraph, agents: PatternAgentDefinition[]): Node<GraphNodeData>[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: resolveNodeType(node.kind),
    position: { x: node.position.x, y: node.position.y },
    data: {
      label: resolveNodeLabel(node, agents),
      kind: node.kind,
      agentId: node.agentId,
      order: node.order,
      readOnly: isSystemNode(node.kind),
    },
    draggable: true,
    selectable: true,
    deletable: false,
  }));
}

export function toCanvasEdges(graph: PatternGraph, mode: OrchestrationMode): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'default',
    animated: mode === 'handoff',
    deletable: false,
  }));
}

export function fromCanvasPositions(
  pattern: PatternDefinition,
  canvasNodes: Node<GraphNodeData>[],
): PatternGraph {
  const graph = resolvePatternGraph(pattern);
  const positionMap = new Map(canvasNodes.map((n) => [n.id, n.position]));

  return {
    nodes: graph.nodes.map((node) => {
      const pos = positionMap.get(node.id);
      return pos ? { ...node, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : node;
    }),
    edges: graph.edges,
  };
}

/* ── Connection rules ──────────────────────────────────────── */

export function isConnectionAllowed(
  connection: Connection,
  mode: OrchestrationMode,
  graph: PatternGraph,
): boolean {
  if (!connection.source || !connection.target) {
    return false;
  }

  if (connection.source === connection.target) {
    return false;
  }

  const sourceNode = graph.nodes.find((n) => n.id === connection.source);
  const targetNode = graph.nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) {
    return false;
  }

  switch (mode) {
    case 'single':
    case 'sequential':
    case 'magentic':
      return false;
    case 'concurrent':
      return false;
    case 'handoff':
      return sourceNode.kind === 'agent' && targetNode.kind === 'agent';
    case 'group-chat':
      return false;
    default:
      return false;
  }
}

/* ── Graph mutation helpers ─────────────────────────────────── */

function edgeId(source: string, target: string): string {
  return `edge-${source}-to-${target}`;
}

export function addHandoffEdge(graph: PatternGraph, source: string, target: string): PatternGraph {
  const newEdge: PatternGraphEdge = {
    id: edgeId(source, target),
    source,
    target,
  };

  if (graph.edges.some((e) => e.source === source && e.target === target)) {
    return graph;
  }

  return { ...graph, edges: [...graph.edges, newEdge] };
}

export function removeEdge(graph: PatternGraph, removeEdgeId: string): PatternGraph {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== removeEdgeId) };
}

/* ── Agent node for selected inspector ─────────────────────── */

export function findAgentForNode(
  nodeId: string,
  graph: PatternGraph,
  agents: PatternAgentDefinition[],
): PatternAgentDefinition | undefined {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node?.agentId) {
    return undefined;
  }

  return agents.find((a) => a.id === node.agentId);
}
