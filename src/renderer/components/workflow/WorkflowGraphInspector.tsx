import { useCallback } from 'react';
import { AlertCircle, Bot, FunctionSquare, GitBranch, Info, Radio, Trash2 } from 'lucide-react';

import {
  findModel,
  getSupportedReasoningEfforts,
  resolveReasoningEffort,
  type ModelDefinition,
} from '@shared/domain/models';
import type {
  EdgeCondition,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowValidationIssue,
  AgentNodeConfig,
} from '@shared/domain/workflow';
import { ModelSelect, ReasoningEffortSelect } from '@renderer/components/AgentConfigFields';
import { InvokeFunctionInspector } from '@renderer/components/workflow/InvokeFunctionInspector';
import { ConditionEditor } from '@renderer/components/workflow/ConditionEditor';
import { RequestPortInspector } from '@renderer/components/workflow/RequestPortInspector';
import { SubWorkflowInspector } from '@renderer/components/workflow/SubWorkflowInspector';

interface WorkflowGraphInspectorProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  workflow: WorkflowDefinition;
  workflows: ReadonlyArray<WorkflowDefinition>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  validationIssues?: WorkflowValidationIssue[];
  onNodeChange: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onNodeConfigChange: (nodeId: string, config: WorkflowNodeConfig) => void;
  onNodeRemove: (nodeId: string) => void;
  onEdgeChange: (edgeId: string, patch: Partial<WorkflowEdge>) => void;
  onEdgeRemove: (edgeId: string) => void;
  onDrillIntoSubWorkflow: (node: WorkflowNode) => void;
}

function InputField({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const base =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50';
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      {multiline ? (
        <textarea
          className={`${base} min-h-20 resize-y`}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      ) : (
        <input
          className={base}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      )}
    </label>
  );
}

/* ── Agent node inspector ──────────────────────────────────── */

function AgentNodeInspector({
  node,
  availableModels,
  onNodeChange,
  onNodeConfigChange,
  onNodeRemove,
}: {
  node: WorkflowNode;
  availableModels: ReadonlyArray<ModelDefinition>;
  onNodeChange: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onNodeConfigChange: (nodeId: string, config: WorkflowNodeConfig) => void;
  onNodeRemove: (nodeId: string) => void;
}) {
  const config = node.config as AgentNodeConfig;
  const model = findModel(config.model, availableModels);

  function patchConfig(patch: Partial<AgentNodeConfig>) {
    onNodeConfigChange(node.id, { ...config, ...patch });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
            <Bot className="size-4 text-[var(--color-text-primary)]" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {config.name || 'Unnamed Agent'}
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

      <InputField
        label="Label"
        onChange={(v) => onNodeChange(node.id, { label: v })}
        placeholder="Display label"
        value={node.label}
      />
      <InputField
        label="Agent Name"
        onChange={(v) => patchConfig({ name: v })}
        placeholder="Agent name"
        value={config.name}
      />
      <InputField
        label="Description"
        onChange={(v) => patchConfig({ description: v })}
        placeholder="What this agent does"
        value={config.description}
      />
      <InputField
        label="Instructions"
        multiline
        onChange={(v) => patchConfig({ instructions: v })}
        placeholder="System instructions for this agent"
        value={config.instructions}
      />

      <div className="space-y-3">
        <ModelSelect
          models={availableModels}
          onChange={(value) => {
            const m = findModel(value, availableModels);
            patchConfig({
              model: value,
              reasoningEffort: resolveReasoningEffort(m, config.reasoningEffort),
            });
          }}
          value={config.model}
        />
        <div className="space-y-1.5">
          <ReasoningEffortSelect
            label="Reasoning"
            onChange={(value) => patchConfig({ reasoningEffort: value })}
            supportedEfforts={getSupportedReasoningEfforts(model)}
            value={config.reasoningEffort}
          />
          <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            Controls how much the model reasons before responding. Higher values produce more careful, thorough answers.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── System node inspector ─────────────────────────────────── */

function SystemNodeInspector({ node }: { node: WorkflowNode }) {
  const kindLabels: Record<string, string> = {
    start: 'Start Node',
    end: 'End Node',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
          <Info className="size-4 text-[var(--color-text-muted)]" />
        </div>
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {kindLabels[node.kind] ?? node.kind}
        </div>
      </div>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        System node — cannot be edited or removed.
      </p>
    </div>
  );
}

/* ── Placeholder inspector for future node kinds ───────────── */

const placeholderIcons: Record<string, typeof FunctionSquare> = {
  'sub-workflow': GitBranch,
  'request-port': Radio,
};

function PlaceholderNodeInspector({
  node,
  onNodeChange,
  onNodeRemove,
}: {
  node: WorkflowNode;
  onNodeChange: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onNodeRemove: (nodeId: string) => void;
}) {
  const Icon = placeholderIcons[node.kind] ?? Info;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
            <Icon className="size-4 text-[var(--color-text-muted)]" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {node.label || node.kind}
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
      <InputField
        label="Label"
        onChange={(v) => onNodeChange(node.id, { label: v })}
        placeholder="Display label"
        value={node.label}
      />
      <div className="rounded-lg border border-[var(--color-status-warning)]/20 bg-[var(--color-status-warning)]/5 px-3 py-2 text-[12px] text-[var(--color-status-warning)]">
        Full configuration for this node type is not yet available.
      </div>
    </div>
  );
}

/* ── Edge inspector ────────────────────────────────────────── */

function EdgeInspector({
  edge,
  validationIssues,
  onEdgeChange,
  onEdgeRemove,
}: {
  edge: WorkflowEdge;
  validationIssues?: WorkflowValidationIssue[];
  onEdgeChange: (edgeId: string, patch: Partial<WorkflowEdge>) => void;
  onEdgeRemove: (edgeId: string) => void;
}) {
  const isFanIn = edge.kind === 'fan-in';
  const edgeIssues = validationIssues?.filter((i) => i.edgeId === edge.id) ?? [];

  const handleConditionChange = useCallback(
    (condition: EdgeCondition | undefined) => {
      onEdgeChange(edge.id, { condition });
    },
    [edge.id, onEdgeChange],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">Edge</div>
        <button
          className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
          onClick={() => onEdgeRemove(edge.id)}
          title="Remove edge"
          type="button"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Kind</span>
        <select
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50"
          onChange={(e) => onEdgeChange(edge.id, { kind: e.target.value as WorkflowEdge['kind'] })}
          value={edge.kind}
        >
          <option value="direct">Direct</option>
          <option value="fan-out">Fan-out</option>
          <option value="fan-in">Fan-in</option>
        </select>
        <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          Direct connects nodes sequentially. Fan-out splits into parallel branches. Fan-in waits for all branches to complete.
        </p>
      </label>

      {/* Loop controls */}
      <div className="space-y-2.5">
        <div className="space-y-1">
          <label className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
              Loop Edge
            </span>
            <input
              checked={edge.isLoop === true}
              className="size-4 accent-[var(--color-accent)]"
              onChange={(e) => {
                if (e.target.checked) {
                  onEdgeChange(edge.id, { isLoop: true, maxIterations: edge.maxIterations ?? 10 });
                } else {
                  onEdgeChange(edge.id, { isLoop: undefined, maxIterations: undefined });
                }
              }}
              type="checkbox"
            />
          </label>
          <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            Creates an iterative cycle, re-executing the path between these nodes up to a set limit.
          </p>
        </div>
        {edge.isLoop && (
          <label className="block space-y-1.5">
            <span className="text-[11px] text-[var(--color-text-muted)]">Max Iterations</span>
            <input
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50"
              min={1}
              onChange={(e) => {
                const raw = parseInt(e.target.value, 10);
                onEdgeChange(edge.id, {
                  maxIterations: Number.isNaN(raw) ? undefined : Math.max(1, raw),
                });
              }}
              type="number"
              value={edge.maxIterations ?? 10}
            />
          </label>
        )}
      </div>

      {/* Condition editor */}
      <div className="space-y-1.5">
        <ConditionEditor
          condition={edge.condition}
          disabled={isFanIn}
          onChange={handleConditionChange}
        />
        {isFanIn && (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Fan-in edges cannot have conditions
          </p>
        )}
      </div>

      <InputField
        label="Label"
        onChange={(v) => onEdgeChange(edge.id, { label: v || undefined })}
        placeholder="Optional edge label"
        value={edge.label ?? ''}
      />

      {/* Validation issues for this edge */}
      {edgeIssues.length > 0 && (
        <div className="space-y-1">
          {edgeIssues.map((issue, i) => (
            <div
              className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] ${
                issue.level === 'error'
                  ? 'bg-[var(--color-status-error)]/10 text-[var(--color-status-error)]'
                  : 'bg-[var(--color-status-warning)]/10 text-[var(--color-status-warning)]'
              }`}
              key={`${issue.field ?? 'v'}-${i}`}
            >
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main inspector component ──────────────────────────────── */

export function WorkflowGraphInspector({
  availableModels,
  workflow,
  workflows,
  selectedNodeId,
  selectedEdgeId,
  validationIssues,
  onNodeChange,
  onNodeConfigChange,
  onNodeRemove,
  onEdgeChange,
  onEdgeRemove,
  onDrillIntoSubWorkflow,
}: WorkflowGraphInspectorProps) {
  const selectedNode = selectedNodeId
    ? workflow.graph.nodes.find((n) => n.id === selectedNodeId)
    : undefined;
  const selectedEdge = selectedEdgeId
    ? workflow.graph.edges.find((e) => e.id === selectedEdgeId)
    : undefined;

  if (selectedEdge) {
    return (
      <div className="p-4">
        <EdgeInspector
          edge={selectedEdge}
          onEdgeChange={onEdgeChange}
          onEdgeRemove={onEdgeRemove}
          validationIssues={validationIssues}
        />
      </div>
    );
  }

  if (!selectedNode) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-[12px] text-[var(--color-text-muted)]">
          Select a node or edge to inspect
        </p>
      </div>
    );
  }

  if (selectedNode.kind === 'start' || selectedNode.kind === 'end') {
    return (
      <div className="p-4">
        <SystemNodeInspector node={selectedNode} />
      </div>
    );
  }

  if (selectedNode.kind === 'agent') {
    return (
      <div className="p-4">
        <AgentNodeInspector
          availableModels={availableModels}
          node={selectedNode}
          onNodeChange={onNodeChange}
          onNodeConfigChange={onNodeConfigChange}
          onNodeRemove={onNodeRemove}
        />
      </div>
    );
  }

  if (selectedNode.kind === 'sub-workflow') {
    return (
      <div className="p-4">
        <SubWorkflowInspector
          currentWorkflowId={workflow.id}
          node={selectedNode}
          onDrillIntoSubWorkflow={onDrillIntoSubWorkflow}
          onNodeChange={onNodeChange}
          onNodeConfigChange={onNodeConfigChange}
          onNodeRemove={onNodeRemove}
          workflows={workflows}
        />
      </div>
    );
  }

  if (selectedNode.kind === 'invoke-function') {
    return (
      <div className="p-4">
        <InvokeFunctionInspector
          node={selectedNode}
          validationIssues={validationIssues}
          onNodeChange={onNodeChange}
          onNodeConfigChange={onNodeConfigChange}
          onNodeRemove={onNodeRemove}
        />
      </div>
    );
  }

  if (selectedNode.kind === 'request-port') {
    return (
      <div className="p-4">
        <RequestPortInspector
          node={selectedNode}
          validationIssues={validationIssues}
          onNodeChange={onNodeChange}
          onNodeConfigChange={onNodeConfigChange}
          onNodeRemove={onNodeRemove}
        />
      </div>
    );
  }

  // Fallback for any future unknown node kinds
  return (
    <div className="p-4">
      <PlaceholderNodeInspector
        node={selectedNode}
        onNodeChange={onNodeChange}
        onNodeRemove={onNodeRemove}
      />
    </div>
  );
}
