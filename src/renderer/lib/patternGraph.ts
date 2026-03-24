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
  switch (kind) {
    case 'user-input':
      return 'userInputNode';
    case 'user-output':
      return 'userOutputNode';
    case 'agent':
      return 'agentNode';
    default:
      return 'systemNode';
  }
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

/** Determines whether user-created edges can be deleted in this mode. */
function isEdgeDeletable(edge: PatternGraphEdge, mode: OrchestrationMode, graph: PatternGraph): boolean {
  if (mode !== 'handoff') {
    return false;
  }

  const sourceNode = graph.nodes.find((n) => n.id === edge.source);
  const targetNode = graph.nodes.find((n) => n.id === edge.target);

  // Only agent↔agent edges in handoff mode are user-deletable;
  // system edges (user-input → triage, agent → user-output) are structural.
  return sourceNode?.kind === 'agent' && targetNode?.kind === 'agent';
}

export function toCanvasEdges(graph: PatternGraph, mode: OrchestrationMode): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    animated: mode === 'handoff',
    deletable: isEdgeDeletable(edge, mode, graph),
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

/** Whether edges can be deleted by the user in this mode. */
export function isEdgeDeletionAllowed(mode: OrchestrationMode): boolean {
  return mode === 'handoff';
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

/* ── Add disconnected agent node ───────────────────────────── */

export function addAgentNodeToGraph(
  graph: PatternGraph,
  agent: PatternAgentDefinition,
): PatternGraph {
  const existingAgentNodes = graph.nodes.filter((n) => n.kind === 'agent');
  const nextOrder = existingAgentNodes.length;

  // Place new node below existing agent nodes
  const maxY = existingAgentNodes.reduce((max, n) => Math.max(max, n.position.y), 0);
  const avgX = existingAgentNodes.length > 0
    ? Math.round(existingAgentNodes.reduce((sum, n) => sum + n.position.x, 0) / existingAgentNodes.length)
    : 400;

  const newNode: PatternGraphNode = {
    id: `agent-node-${agent.id}`,
    kind: 'agent',
    agentId: agent.id,
    order: nextOrder,
    position: { x: avgX, y: maxY + 120 },
  };

  return { ...graph, nodes: [...graph.nodes, newNode] };
}

/* ── Sequential reorder ────────────────────────────────────── */

export function swapSequentialOrder(
  graph: PatternGraph,
  agentNodeId: string,
  direction: 'up' | 'down',
): PatternGraph {
  const agentNodes = graph.nodes
    .filter((n) => n.kind === 'agent')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const currentIndex = agentNodes.findIndex((n) => n.id === agentNodeId);
  if (currentIndex < 0) {
    return graph;
  }

  const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (swapIndex < 0 || swapIndex >= agentNodes.length) {
    return graph;
  }

  const currentNode = agentNodes[currentIndex]!;
  const swapNode = agentNodes[swapIndex]!;

  // Swap order values
  const updatedNodes = graph.nodes.map((n) => {
    if (n.id === currentNode.id) {
      return { ...n, order: swapNode.order, position: { ...swapNode.position } };
    }
    if (n.id === swapNode.id) {
      return { ...n, order: currentNode.order, position: { ...currentNode.position } };
    }
    return n;
  });

  // Rebuild linear edges: input → agent₁ → agent₂ → ... → output
  const inputNode = graph.nodes.find((n) => n.kind === 'user-input');
  const outputNode = graph.nodes.find((n) => n.kind === 'user-output');
  const sortedAgents = updatedNodes
    .filter((n) => n.kind === 'agent')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const path = [
    ...(inputNode ? [inputNode.id] : []),
    ...sortedAgents.map((n) => n.id),
    ...(outputNode ? [outputNode.id] : []),
  ];

  const newEdges: PatternGraphEdge[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    newEdges.push({ id: edgeId(path[i]!, path[i + 1]!), source: path[i]!, target: path[i + 1]! });
  }

  return { nodes: updatedNodes, edges: newEdges };
}

/** Check if an agent node can be moved up or down in sequential order. */
export function canMoveSequential(
  graph: PatternGraph,
  agentNodeId: string,
  direction: 'up' | 'down',
): boolean {
  const agentNodes = graph.nodes
    .filter((n) => n.kind === 'agent')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const index = agentNodes.findIndex((n) => n.id === agentNodeId);
  if (index < 0) {
    return false;
  }

  return direction === 'up' ? index > 0 : index < agentNodes.length - 1;
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
