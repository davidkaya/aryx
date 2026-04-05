import dagre from '@dagrejs/dagre';
import { MarkerType, type Node, type Edge, type Connection } from '@xyflow/react';

import type {
  WorkflowDefinition,
  WorkflowEdge as WfEdge,
  WorkflowEdgeKind,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeKind,
} from '@shared/domain/workflow';
import type { ModelProvider } from '@shared/domain/models';
import { inferProvider, findModel, type ModelDefinition } from '@shared/domain/models';

/* ── Canvas node data ──────────────────────────────────────── */

export interface WorkflowGraphNodeData extends Record<string, unknown> {
  label: string;
  kind: WorkflowNodeKind;
  /** AI provider inferred from the agent's model (agent nodes only). */
  provider?: ModelProvider;
  /** Short display name for the agent's model (agent nodes only). */
  modelLabel?: string;
}

/* ── View-model projection ─────────────────────────────────── */

function resolveNodeType(kind: WorkflowNodeKind): string {
  switch (kind) {
    case 'start':
      return 'startNode';
    case 'end':
      return 'endNode';
    case 'agent':
      return 'agentNode';
    case 'code-executor':
      return 'codeExecutorNode';
    case 'function-executor':
      return 'functionExecutorNode';
    case 'sub-workflow':
      return 'subWorkflowNode';
    case 'request-port':
      return 'requestPortNode';
  }
}

export function toCanvasNodes(
  graph: WorkflowGraph,
  models?: ReadonlyArray<ModelDefinition>,
): Node<WorkflowGraphNodeData>[] {
  return graph.nodes.map((node) => {
    let provider: ModelProvider | undefined;
    let modelLabel: string | undefined;

    if (node.kind === 'agent' && node.config.kind === 'agent') {
      const modelId = node.config.model;
      if (modelId) {
        provider = inferProvider(modelId);
        const modelDef = models ? findModel(modelId, models) : undefined;
        modelLabel = modelDef?.name ?? modelId;
      }
    }

    const isSystemNode = node.kind === 'start' || node.kind === 'end';

    return {
      id: node.id,
      type: resolveNodeType(node.kind),
      position: { x: node.position.x, y: node.position.y },
      data: {
        label: node.label,
        kind: node.kind,
        provider,
        modelLabel,
      },
      draggable: true,
      selectable: true,
      deletable: !isSystemNode,
    };
  });
}

/* ── Edge styling ──────────────────────────────────────────── */

const EDGE_COLORS: Record<WorkflowEdgeKind, { stroke: string; markerColor: string }> = {
  direct: { stroke: '#6366f1', markerColor: '#6366f1' },
  'fan-out': { stroke: '#f59e0b', markerColor: '#f59e0b' },
  'fan-in': { stroke: '#10b981', markerColor: '#10b981' },
};

const EDGE_DASH: Record<WorkflowEdgeKind, string | undefined> = {
  direct: undefined,
  'fan-out': '6 3',
  'fan-in': '2 2',
};

const LOOP_EDGE_COLOR = { stroke: '#c084fc', markerColor: '#c084fc' };
const LOOP_EDGE_DASH = '8 4';

function buildEdgeLabel(edge: WfEdge): string | undefined {
  const parts: string[] = [];

  if (edge.condition && edge.condition.type !== 'always') {
    parts.push('⚡');
  }

  if (edge.label) {
    parts.push(edge.label);
  }

  if (edge.isLoop && edge.maxIterations) {
    parts.push(`🔁 ×${edge.maxIterations}`);
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function toCanvasEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map((edge) => {
    const isLoop = edge.isLoop === true;
    const isSelfLoop = edge.source === edge.target;
    const color = isLoop ? LOOP_EDGE_COLOR : (EDGE_COLORS[edge.kind] ?? EDGE_COLORS.direct);
    const dashArray = isLoop ? LOOP_EDGE_DASH : EDGE_DASH[edge.kind];

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: isSelfLoop ? 'selfLoop' : 'default',
      animated: isLoop || edge.kind === 'fan-out',
      deletable: true,
      label: buildEdgeLabel(edge),
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: color.markerColor },
      style: {
        stroke: color.stroke,
        strokeWidth: 1.5,
        ...(dashArray ? { strokeDasharray: dashArray } : {}),
      },
    };
  });
}

/* ── Position sync ─────────────────────────────────────────── */

export function fromCanvasPositions(
  workflow: WorkflowDefinition,
  canvasNodes: Node[],
): WorkflowGraph {
  const positionMap = new Map(canvasNodes.map((n) => [n.id, n.position]));

  return {
    nodes: workflow.graph.nodes.map((node) => {
      const pos = positionMap.get(node.id);
      return pos ? { ...node, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : node;
    }),
    edges: workflow.graph.edges,
  };
}

/* ── Connection rules ──────────────────────────────────────── */

export function isWorkflowConnectionAllowed(
  connection: Connection,
  graph: WorkflowGraph,
): boolean {
  if (!connection.source || !connection.target) {
    return false;
  }

  const sourceNode = graph.nodes.find((n) => n.id === connection.source);
  const targetNode = graph.nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) {
    return false;
  }

  // Start nodes cannot receive incoming edges
  if (targetNode.kind === 'start') {
    return false;
  }

  // End nodes cannot have outgoing edges
  if (sourceNode.kind === 'end') {
    return false;
  }

  // No duplicate edges
  if (graph.edges.some((e) => e.source === connection.source && e.target === connection.target)) {
    return false;
  }

  return true;
}

/* ── Graph mutation helpers ─────────────────────────────────── */

function edgeId(source: string, target: string): string {
  return `edge-${source}-to-${target}`;
}

export function addWorkflowEdge(graph: WorkflowGraph, source: string, target: string): WorkflowGraph {
  const newEdge: WfEdge = {
    id: edgeId(source, target),
    source,
    target,
    kind: 'direct',
  };

  if (graph.edges.some((e) => e.source === source && e.target === target)) {
    return graph;
  }

  return { ...graph, edges: [...graph.edges, newEdge] };
}

export function removeWorkflowEdge(graph: WorkflowGraph, removeEdgeId: string): WorkflowGraph {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== removeEdgeId) };
}

/* ── Auto-layout via dagre ─────────────────────────────────── */

const NODE_WIDTH = 170;
const NODE_HEIGHT = 52;

export function autoLayoutWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    nodesep: 60,
    ranksep: 120,
    marginx: 20,
    marginy: 20,
  });

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = graph.nodes.map((node) => {
    const dagreNode = g.node(node.id);
    return {
      ...node,
      position: {
        x: Math.round(dagreNode.x - NODE_WIDTH / 2),
        y: Math.round(dagreNode.y - NODE_HEIGHT / 2),
      },
    };
  });

  return { nodes: layoutedNodes, edges: graph.edges };
}
