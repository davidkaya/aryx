import { useCallback } from 'react';
import { ExternalLink, GitBranch, Link, Pencil, Trash2 } from 'lucide-react';

import type {
  SubWorkflowConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
} from '@shared/domain/workflow';

interface SubWorkflowInspectorProps {
  node: WorkflowNode;
  workflows: ReadonlyArray<WorkflowDefinition>;
  currentWorkflowId: string;
  onNodeChange: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onNodeConfigChange: (nodeId: string, config: WorkflowNodeConfig) => void;
  onNodeRemove: (nodeId: string) => void;
  onDrillIntoSubWorkflow: (node: WorkflowNode) => void;
}

type SourceMode = 'reference' | 'inline';

function resolveSourceMode(config: SubWorkflowConfig): SourceMode {
  if (config.workflowId) return 'reference';
  if (config.inlineWorkflow) return 'inline';
  return 'reference';
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

export function SubWorkflowInspector({
  node,
  workflows,
  currentWorkflowId,
  onNodeChange,
  onNodeConfigChange,
  onNodeRemove,
  onDrillIntoSubWorkflow,
}: SubWorkflowInspectorProps) {
  const config = node.config as SubWorkflowConfig;
  const sourceMode = resolveSourceMode(config);

  const availableWorkflows = workflows.filter((wf) => wf.id !== currentWorkflowId);
  const selectedWorkflow = config.workflowId
    ? workflows.find((wf) => wf.id === config.workflowId)
    : undefined;

  const handleModeChange = useCallback(
    (mode: SourceMode) => {
      if (mode === 'reference') {
        onNodeConfigChange(node.id, { kind: 'sub-workflow', workflowId: config.workflowId });
      } else {
        onNodeConfigChange(node.id, {
          kind: 'sub-workflow',
          inlineWorkflow: config.inlineWorkflow,
        });
      }
    },
    [node.id, config.workflowId, config.inlineWorkflow, onNodeConfigChange],
  );

  const handleWorkflowSelect = useCallback(
    (workflowId: string) => {
      onNodeConfigChange(node.id, {
        kind: 'sub-workflow',
        workflowId: workflowId || undefined,
      });
    },
    [node.id, onNodeConfigChange],
  );

  const handleDrillIn = useCallback(() => {
    onDrillIntoSubWorkflow(node);
  }, [node, onDrillIntoSubWorkflow]);

  const inlineNodeCount = config.inlineWorkflow?.graph?.nodes?.length ?? 0;
  const inlineEdgeCount = config.inlineWorkflow?.graph?.edges?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10">
            <GitBranch className="size-4 text-amber-400" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {node.label || 'Sub-Workflow'}
          </div>
        </div>
        <button
          className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
          onClick={() => onNodeRemove(node.id)}
          title="Remove node"
          type="button"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Label */}
      <InputField
        label="Label"
        onChange={(v) => onNodeChange(node.id, { label: v })}
        placeholder="Display label"
        value={node.label}
      />

      {/* Source mode selector */}
      <div className="space-y-1.5">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Source</span>
        <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-0.5">
          <button
            className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all duration-200 ${
              sourceMode === 'reference'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
            onClick={() => handleModeChange('reference')}
            type="button"
          >
            Reference
          </button>
          <button
            className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all duration-200 ${
              sourceMode === 'inline'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
            onClick={() => handleModeChange('inline')}
            type="button"
          >
            Inline
          </button>
        </div>
      </div>

      {/* Reference mode */}
      {sourceMode === 'reference' && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
              Workflow
            </span>
            <select
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50"
              onChange={(e) => handleWorkflowSelect(e.target.value)}
              value={config.workflowId ?? ''}
            >
              <option value="">Select a workflow…</option>
              {availableWorkflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name || 'Untitled'}
                </option>
              ))}
            </select>
          </label>

          {selectedWorkflow?.description && (
            <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {selectedWorkflow.description}
            </p>
          )}

          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-medium text-[var(--color-accent)] transition-all duration-200 hover:bg-[var(--color-accent)]/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!config.workflowId || !selectedWorkflow}
            onClick={handleDrillIn}
            type="button"
          >
            <ExternalLink className="size-3" />
            Open Sub-Workflow
          </button>
        </div>
      )}

      {/* Inline mode */}
      {sourceMode === 'inline' && (
        <div className="space-y-3">
          {config.inlineWorkflow ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-400">
              <Link className="size-3 shrink-0" />
              <span>
                {inlineNodeCount} node{inlineNodeCount !== 1 ? 's' : ''},{' '}
                {inlineEdgeCount} edge{inlineEdgeCount !== 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              No inline workflow configured yet.
            </p>
          )}

          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-medium text-[var(--color-accent)] transition-all duration-200 hover:bg-[var(--color-accent)]/10"
            onClick={handleDrillIn}
            type="button"
          >
            <Pencil className="size-3" />
            Edit Inline Workflow
          </button>
        </div>
      )}
    </div>
  );
}
