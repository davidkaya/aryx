import { BaseEdge, type EdgeProps } from '@xyflow/react';

function SelfLoopEdge({ id, sourceX, sourceY, style, markerEnd }: EdgeProps) {
  const loopHeight = 60;
  const loopWidth = 40;

  const path = `M ${sourceX} ${sourceY} C ${sourceX + loopWidth} ${sourceY - loopHeight}, ${sourceX - loopWidth} ${sourceY - loopHeight}, ${sourceX} ${sourceY}`;

  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}

export const workflowEdgeTypes = {
  selfLoop: SelfLoopEdge,
} as const;
