import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CircleUser, Bot, Shuffle, Layers, Radio } from 'lucide-react';

import type { GraphNodeData } from '@renderer/lib/patternGraph';
import type { PatternGraphNodeKind } from '@shared/domain/pattern';

const kindIcons: Record<PatternGraphNodeKind, typeof CircleUser> = {
  'user-input': CircleUser,
  'user-output': CircleUser,
  agent: Bot,
  distributor: Shuffle,
  collector: Layers,
  orchestrator: Radio,
};

const kindColors: Record<PatternGraphNodeKind, { bg: string; border: string; text: string }> = {
  'user-input': { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400' },
  'user-output': { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400' },
  agent: { bg: 'bg-zinc-800/80', border: 'border-zinc-600/40', text: 'text-zinc-200' },
  distributor: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400' },
  collector: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400' },
  orchestrator: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
};

function GraphNodeContent({ data, selected }: { data: GraphNodeData; selected: boolean }) {
  const Icon = kindIcons[data.kind] ?? Bot;
  const colors = kindColors[data.kind] ?? kindColors.agent;
  const isAgent = data.kind === 'agent';

  return (
    <div
      className={`flex min-w-[120px] items-center gap-2 rounded-xl border px-3 py-2 shadow-md transition ${
        colors.bg
      } ${selected ? 'ring-2 ring-indigo-500/50' : ''} ${colors.border}`}
    >
      <Icon className={`size-4 shrink-0 ${colors.text}`} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12px] font-semibold ${colors.text}`}>
          {data.label}
        </div>
        {isAgent && typeof data.order === 'number' && (
          <div className="text-[10px] text-zinc-500">#{data.order + 1}</div>
        )}
      </div>
      {data.readOnly && (
        <span className="ml-1 rounded bg-zinc-700/50 px-1 py-0.5 text-[8px] font-medium text-zinc-500">
          SYS
        </span>
      )}
    </div>
  );
}

export const SystemNode = memo(function SystemNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as GraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!size-2 !border-zinc-600 !bg-zinc-400" />
      <GraphNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className="!size-2 !border-zinc-600 !bg-zinc-400" />
    </>
  );
});

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as GraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!size-2 !border-indigo-400 !bg-indigo-500" />
      <GraphNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className="!size-2 !border-indigo-400 !bg-indigo-500" />
    </>
  );
});

export const graphNodeTypes = {
  systemNode: SystemNode,
  agentNode: AgentNode,
};
