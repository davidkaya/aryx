import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Panel,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutGrid } from 'lucide-react';

import type { WorkflowDefinition, WorkflowGraph } from '@shared/domain/workflow';
import type { ModelDefinition } from '@shared/domain/models';
import {
  addWorkflowEdge,
  autoLayoutWorkflowGraph,
  fromCanvasPositions,
  isWorkflowConnectionAllowed,
  removeWorkflowEdge,
  toCanvasEdges,
  toCanvasNodes,
  type WorkflowGraphNodeData,
} from '@renderer/lib/workflowGraph';

import { workflowNodeTypes } from './WorkflowGraphNodes';
import { workflowEdgeTypes } from './WorkflowGraphEdges';

interface WorkflowGraphCanvasProps {
  workflow: WorkflowDefinition;
  availableModels?: ReadonlyArray<ModelDefinition>;
  workflows?: ReadonlyArray<WorkflowDefinition>;
  onGraphChange: (graph: WorkflowGraph) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onEdgeSelect: (edgeId: string | null) => void;
  selectedNodeId: string | null;
}

function WorkflowGraphCanvasInner({
  workflow,
  availableModels,
  workflows,
  onGraphChange,
  onNodeSelect,
  onEdgeSelect,
  selectedNodeId,
}: WorkflowGraphCanvasProps) {
  const { fitView } = useReactFlow();
  const graph = workflow.graph;
  const draggingRef = useRef(false);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(
    toCanvasNodes(graph, availableModels, workflows),
  );
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(
    toCanvasEdges(graph),
  );

  useEffect(() => {
    setNodes(toCanvasNodes(graph, availableModels, workflows));
    setEdges(toCanvasEdges(graph));
  }, [graph, availableModels, workflows, setNodes, setEdges]);

  const handleNodesChange: OnNodesChange<Node<WorkflowGraphNodeData>> = useCallback(
    (changes) => {
      const removals = changes.filter((c) => c.type === 'remove');
      const nonRemovals = changes.filter((c) => c.type !== 'remove');

      if (removals.length > 0) {
        let updatedGraph = graph;
        for (const removal of removals) {
          if (removal.type === 'remove') {
            const node = graph.nodes.find((n) => n.id === removal.id);
            if (node && node.kind !== 'start' && node.kind !== 'end') {
              updatedGraph = {
                ...updatedGraph,
                nodes: updatedGraph.nodes.filter((n) => n.id !== removal.id),
                edges: updatedGraph.edges.filter((e) => e.source !== removal.id && e.target !== removal.id),
              };
            }
          }
        }
        if (updatedGraph !== graph) {
          onGraphChange(updatedGraph);
          onNodeSelect(null);
        }
      }

      if (nonRemovals.length > 0) {
        onNodesChangeBase(nonRemovals);
      }

      const hasDragStart = nonRemovals.some(
        (c) => c.type === 'position' && 'dragging' in c && c.dragging,
      );
      const hasDragStop = nonRemovals.some(
        (c) => c.type === 'position' && !('dragging' in c && c.dragging),
      );

      if (hasDragStart) {
        draggingRef.current = true;
      }

      if (hasDragStop && draggingRef.current) {
        draggingRef.current = false;
        setNodes((currentNodes) => {
          const updatedGraph = fromCanvasPositions(workflow, currentNodes);
          onGraphChange(updatedGraph);
          return currentNodes;
        });
      }
    },
    [onNodesChangeBase, workflow, graph, onGraphChange, onNodeSelect, setNodes],
  );

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const removals = changes.filter((c) => c.type === 'remove');
      if (removals.length > 0) {
        let updatedGraph = graph;
        for (const removal of removals) {
          if (removal.type === 'remove') {
            updatedGraph = removeWorkflowEdge(updatedGraph, removal.id);
          }
        }
        onGraphChange(updatedGraph);
        onEdgeSelect(null);
      }

      const nonRemovals = changes.filter((c) => c.type !== 'remove');
      if (nonRemovals.length > 0) {
        onEdgesChangeBase(nonRemovals);
      }
    },
    [onEdgesChangeBase, graph, onGraphChange, onEdgeSelect],
  );

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (!isWorkflowConnectionAllowed(connection, graph)) {
        return;
      }

      if (connection.source && connection.target) {
        const updatedGraph = addWorkflowEdge(graph, connection.source, connection.target);
        onGraphChange(updatedGraph);
      }
    },
    [graph, onGraphChange],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<WorkflowGraphNodeData>) => {
      onNodeSelect(node.id);
      onEdgeSelect(null);
    },
    [onNodeSelect, onEdgeSelect],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onEdgeSelect(edge.id);
      onNodeSelect(null);
    },
    [onEdgeSelect, onNodeSelect],
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
    onEdgeSelect(null);
  }, [onNodeSelect, onEdgeSelect]);

  const handleAutoLayout = useCallback(() => {
    const layouted = autoLayoutWorkflowGraph(graph);
    onGraphChange(layouted);
    requestAnimationFrame(() => fitView({ padding: 0.3 }));
  }, [graph, onGraphChange, fitView]);

  return (
    <div className="h-full w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-0)]/50">
      <ReactFlow
        nodes={nodes.map((n) => ({
          ...n,
          selected: n.id === selectedNodeId,
        }))}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={workflowNodeTypes}
        edgeTypes={workflowEdgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'default',
          style: { stroke: '#6366f1', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#6366f1' },
        }}
        connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 1.5 }}
        deleteKeyCode="Delete"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a1e2e" />
        <MiniMap
          className="!rounded-lg !border !border-[var(--color-border)] !bg-[var(--color-surface-1)]"
          maskColor="rgba(0,0,0,0.6)"
          nodeColor="#3f3f46"
        />
        <Panel position="top-right">
          <button
            type="button"
            onClick={handleAutoLayout}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/90 px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] shadow-sm backdrop-blur transition hover:border-[var(--color-border-glow)] hover:bg-[var(--color-surface-3)]/90 hover:text-[var(--color-text-primary)]"
            title="Auto-layout nodes"
          >
            <LayoutGrid className="size-3.5" />
            Auto layout
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function WorkflowGraphCanvas(props: WorkflowGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowGraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
