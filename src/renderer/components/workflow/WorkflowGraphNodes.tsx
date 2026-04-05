import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot, Circle, FunctionSquare, GitBranch, Link2, Radio, Play, Square } from 'lucide-react';

import type { WorkflowGraphNodeData } from '@renderer/lib/workflowGraph';
import type { WorkflowNodeKind } from '@shared/domain/workflow';
import { ProviderIcon } from '@renderer/components/ProviderIcons';

/* ── Styling constants ─────────────────────────────────────── */

const kindColors: Record<WorkflowNodeKind, { bg: string; border: string; text: string }> = {
  start: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
  end: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400' },
  agent: { bg: 'bg-[var(--color-surface-2)]/80', border: 'border-[var(--color-border)]/40', text: 'text-[var(--color-text-primary)]' },
  'invoke-function': { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400' },
  'sub-workflow': { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400' },
  'request-port': { bg: 'bg-teal-500/10', border: 'border-teal-500/30', text: 'text-teal-400' },
};

const kindIcons: Record<WorkflowNodeKind, typeof Bot> = {
  start: Play,
  end: Square,
  agent: Bot,
  'invoke-function': FunctionSquare,
  'sub-workflow': GitBranch,
  'request-port': Radio,
};

const handleStyles = {
  flow: '!size-2 !border-[var(--color-border)] !bg-[var(--color-text-secondary)]',
  agent: '!size-2 !border-[var(--color-accent-sky)] !bg-[var(--color-accent)]',
  hidden: '!size-0 !border-0 !bg-transparent !min-w-0 !min-h-0',
};

/* ── Shared node content ───────────────────────────────────── */

function WorkflowNodeContent({ data, selected }: { data: WorkflowGraphNodeData; selected: boolean }) {
  const colors = kindColors[data.kind] ?? kindColors.agent;
  const isAgent = data.kind === 'agent';
  const isSubWorkflow = data.kind === 'sub-workflow';

  const renderIcon = () => {
    if (isAgent && data.provider) {
      return <ProviderIcon provider={data.provider} className="size-4 shrink-0" />;
    }
    const FallbackIcon = kindIcons[data.kind] ?? Circle;
    return <FallbackIcon className={`size-4 shrink-0 ${colors.text}`} />;
  };

  return (
    <div
      className={`flex min-w-[120px] items-center gap-2 rounded-xl border px-3 py-2 shadow-md backdrop-blur-sm transition ${
        colors.bg
      } ${selected ? 'ring-2 ring-[var(--color-accent)]/50' : ''} ${colors.border}`}
    >
      {renderIcon()}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12px] font-semibold ${colors.text}`}>
          {data.label}
        </div>
        {isAgent && data.modelLabel && (
          <div className="truncate text-[10px] text-[var(--color-text-muted)]">{data.modelLabel}</div>
        )}
        {isSubWorkflow && data.subWorkflowLabel && (
          <div className="truncate text-[10px] text-[var(--color-text-muted)]">
            {data.subWorkflowLabel === 'Inline' ? (
              <span className="rounded bg-amber-500/15 px-1 py-0.5 text-amber-400">Inline</span>
            ) : (
              <span className="flex items-center gap-0.5">
                <Link2 className="inline size-2.5" />
                {data.subWorkflowLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Node type components (all memoized) ───────────────────── */

export const StartNode = memo(function StartNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleStyles.hidden} />
      <WorkflowNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className={handleStyles.flow} />
    </>
  );
});

export const EndNode = memo(function EndNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleStyles.flow} />
      <WorkflowNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className={handleStyles.hidden} />
    </>
  );
});

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleStyles.agent} />
      <WorkflowNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className={handleStyles.agent} />
    </>
  );
});

export const InvokeFunctionNode = memo(function InvokeFunctionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleStyles.flow} />
      <WorkflowNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className={handleStyles.flow} />
    </>
  );
});

export const SubWorkflowNode = memo(function SubWorkflowNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleStyles.flow} />
      <WorkflowNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className={handleStyles.flow} />
    </>
  );
});

export const RequestPortNode = memo(function RequestPortNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleStyles.flow} />
      <WorkflowNodeContent data={nodeData} selected={selected ?? false} />
      <Handle type="source" position={Position.Right} className={handleStyles.flow} />
    </>
  );
});

/* ── Node type map for ReactFlow ───────────────────────────── */

export const workflowNodeTypes = {
  startNode: StartNode,
  endNode: EndNode,
  agentNode: AgentNode,
  invokeFunctionNode: InvokeFunctionNode,
  subWorkflowNode: SubWorkflowNode,
  requestPortNode: RequestPortNode,
};
