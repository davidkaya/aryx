import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { OrchestrationMode, PatternDefinition, PatternGraph } from '@shared/domain/pattern';
import { resolvePatternGraph } from '@shared/domain/pattern';
import {
  addHandoffEdge,
  fromCanvasPositions,
  isConnectionAllowed,
  isEdgeDeletionAllowed,
  removeEdge,
  toCanvasEdges,
  toCanvasNodes,
  type GraphNodeData,
} from '@renderer/lib/patternGraph';

import { graphNodeTypes } from './GraphNodes';

interface PatternGraphCanvasProps {
  pattern: PatternDefinition;
  onGraphChange: (graph: PatternGraph) => void;
  onNodeSelect: (nodeId: string | null) => void;
  selectedNodeId: string | null;
}

export function PatternGraphCanvas({
  pattern,
  onGraphChange,
  onNodeSelect,
  selectedNodeId,
}: PatternGraphCanvasProps) {
  const graph = useMemo(() => resolvePatternGraph(pattern), [pattern]);
  const draggingRef = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    toCanvasNodes(graph, pattern.agents),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toCanvasEdges(graph, pattern.mode),
  );

  // Sync canvas when pattern changes externally
  useEffect(() => {
    setNodes(toCanvasNodes(graph, pattern.agents));
    setEdges(toCanvasEdges(graph, pattern.mode));
  }, [graph, pattern.agents, pattern.mode, setNodes, setEdges]);

  const handleNodesChange: OnNodesChange<Node<GraphNodeData>> = useCallback(
    (changes) => {
      onNodesChange(changes);

      const hasDragStart = changes.some(
        (c) => c.type === 'position' && 'dragging' in c && c.dragging,
      );
      const hasDragStop = changes.some(
        (c) => c.type === 'position' && !('dragging' in c && c.dragging),
      );

      if (hasDragStart) {
        draggingRef.current = true;
      }

      if (hasDragStop && draggingRef.current) {
        draggingRef.current = false;
        setNodes((currentNodes) => {
          const updatedGraph = fromCanvasPositions(pattern, currentNodes);
          onGraphChange(updatedGraph);
          return currentNodes;
        });
      }
    },
    [onNodesChange, pattern, onGraphChange, setNodes],
  );

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      // Block all edge deletions in modes that don't support it
      if (!isEdgeDeletionAllowed(pattern.mode)) {
        const filtered = changes.filter((c) => c.type !== 'remove');
        if (filtered.length > 0) {
          onEdgesChange(filtered);
        }
        return;
      }

      // For handoff mode, apply removals to the authoritative graph
      const removals = changes.filter((c) => c.type === 'remove');
      if (removals.length > 0) {
        let updatedGraph = graph;
        for (const removal of removals) {
          if (removal.type === 'remove') {
            updatedGraph = removeEdge(updatedGraph, removal.id);
          }
        }
        onGraphChange(updatedGraph);
      }

      const nonRemovals = changes.filter((c) => c.type !== 'remove');
      if (nonRemovals.length > 0) {
        onEdgesChange(nonRemovals);
      }
    },
    [onEdgesChange, pattern.mode, graph, onGraphChange],
  );

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (!isConnectionAllowed(connection, pattern.mode, graph)) {
        return;
      }

      if (connection.source && connection.target) {
        const updatedGraph = addHandoffEdge(graph, connection.source, connection.target);
        onGraphChange(updatedGraph);
      }
    },
    [graph, pattern.mode, onGraphChange],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<GraphNodeData>) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect],
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  return (
    <div className="h-full w-full rounded-xl border border-zinc-800 bg-zinc-950/50">
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
        onPaneClick={handlePaneClick}
        nodeTypes={graphNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#52525b', strokeWidth: 1.5 },
        }}
        connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 1.5 }}
        deleteKeyCode="Delete"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
      </ReactFlow>
    </div>
  );
}
