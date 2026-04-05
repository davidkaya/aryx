import { useState } from 'react';
import { AlertCircle, CheckCircle, ChevronLeft, Trash2 } from 'lucide-react';

import type { ModelDefinition } from '@shared/domain/models';
import type {
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowNodeKind,
  WorkflowEdge,
  AgentNodeConfig,
} from '@shared/domain/workflow';
import { validateWorkflowDefinition } from '@shared/domain/workflow';
import { createId } from '@shared/utils/ids';
import { ToggleSwitch } from '@renderer/components/ui';

import { WorkflowGraphCanvas } from './workflow/WorkflowGraphCanvas';
import { WorkflowGraphInspector } from './workflow/WorkflowGraphInspector';
import { WorkflowNodePalette } from './workflow/WorkflowNodePalette';

interface WorkflowEditorProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  workflow: WorkflowDefinition;
  onChange: (workflow: WorkflowDefinition) => void;
  onDelete?: () => void;
  onSave: () => void;
  onBack: () => void;
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
  const baseClasses =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition-all duration-200 focus:border-[var(--color-accent)]/50';
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      {multiline ? (
        <textarea
          className={`${baseClasses} min-h-20 resize-y`}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      ) : (
        <input
          className={baseClasses}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      )}
    </label>
  );
}

/* ── Default configs for new nodes ─────────────────────────── */

function defaultConfigForKind(kind: WorkflowNodeKind): WorkflowNodeConfig {
  switch (kind) {
    case 'start':
      return { kind: 'start' };
    case 'end':
      return { kind: 'end' };
    case 'agent':
      return {
        kind: 'agent',
        id: createId('agent'),
        name: 'New Agent',
        description: '',
        instructions: '',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      };
    case 'code-executor':
      return { kind: 'code-executor' };
    case 'function-executor':
      return { kind: 'function-executor', functionRef: '' };
    case 'sub-workflow':
      return { kind: 'sub-workflow' };
    case 'request-port':
      return { kind: 'request-port', portId: '', requestType: '', responseType: '' };
  }
}

function defaultLabelForKind(kind: WorkflowNodeKind): string {
  switch (kind) {
    case 'start':
      return 'Start';
    case 'end':
      return 'End';
    case 'agent':
      return 'New Agent';
    case 'code-executor':
      return 'Code Executor';
    case 'function-executor':
      return 'Function';
    case 'sub-workflow':
      return 'Sub-Workflow';
    case 'request-port':
      return 'Request Port';
  }
}

/* ── Main editor ───────────────────────────────────────────── */

export function WorkflowEditor({
  availableModels,
  workflow,
  onChange,
  onDelete,
  onSave,
  onBack,
}: WorkflowEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const issues = validateWorkflowDefinition(workflow);

  function emitChange(next: WorkflowDefinition) {
    onChange(next);
  }

  function emitGraphChange(graph: WorkflowGraph) {
    onChange({ ...workflow, graph });
  }

  function handleAddNode(kind: WorkflowNodeKind) {
    const nodeId = createId(`wf-${kind}`);
    const newNode: WorkflowNode = {
      id: nodeId,
      kind,
      label: defaultLabelForKind(kind),
      position: { x: 300, y: 200 },
      config: defaultConfigForKind(kind),
    };
    emitGraphChange({
      ...workflow.graph,
      nodes: [...workflow.graph.nodes, newNode],
    });
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }

  function handleNodeChange(nodeId: string, patch: Partial<WorkflowNode>) {
    emitGraphChange({
      ...workflow.graph,
      nodes: workflow.graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    });
  }

  function handleNodeConfigChange(nodeId: string, config: WorkflowNodeConfig) {
    emitGraphChange({
      ...workflow.graph,
      nodes: workflow.graph.nodes.map((n) => (n.id === nodeId ? { ...n, config } : n)),
    });
  }

  function handleNodeRemove(nodeId: string) {
    const node = workflow.graph.nodes.find((n) => n.id === nodeId);
    if (!node || node.kind === 'start' || node.kind === 'end') {
      return;
    }

    emitGraphChange({
      nodes: workflow.graph.nodes.filter((n) => n.id !== nodeId),
      edges: workflow.graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    });
    setSelectedNodeId(null);
  }

  function handleEdgeChange(edgeId: string, patch: Partial<WorkflowEdge>) {
    emitGraphChange({
      ...workflow.graph,
      edges: workflow.graph.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
    });
  }

  function handleEdgeRemove(edgeId: string) {
    emitGraphChange({
      ...workflow.graph,
      edges: workflow.graph.edges.filter((e) => e.id !== edgeId),
    });
    setSelectedEdgeId(null);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="drag-region flex items-center justify-between border-b border-[var(--color-border)] pb-3 pl-5 pr-36 pt-3">
        <div className="flex items-center gap-3">
          <button
            className="no-drag flex size-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
            onClick={onBack}
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div>
            <h3 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">
              {workflow.name || 'Untitled workflow'}
            </h3>
            <p className="text-[12px] text-[var(--color-text-muted)]">Workflow Designer</p>
          </div>
        </div>
        <div className="no-drag flex items-center gap-2">
          {onDelete && (
            <button
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-[var(--color-status-error)] transition-all duration-200 hover:bg-[var(--color-status-error)]/10"
              onClick={onDelete}
              type="button"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          )}
          <button
            className="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-medium text-white transition-all duration-200 hover:bg-[var(--color-accent-sky)]"
            onClick={onSave}
            type="button"
          >
            Save
          </button>
        </div>
      </div>

      {/* Body — palette + canvas + inspector */}
      <div className="flex min-h-0 flex-1">
        {/* Left palette */}
        <div className="w-40 shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface-1)]">
          <WorkflowNodePalette onAddNode={handleAddNode} />
        </div>

        {/* Center column: validation + canvas + settings */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Validation banner */}
          <div className="px-5 pt-4">
            {issues.length > 0 ? (
              <div className="space-y-1.5">
                {issues.map((issue, i) => (
                  <div
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] ${
                      issue.level === 'error'
                        ? 'bg-[var(--color-status-error)]/10 text-[var(--color-status-error)]'
                        : 'bg-[var(--color-status-warning)]/10 text-[var(--color-status-warning)]'
                    }`}
                    key={`${issue.field ?? 'v'}-${i}`}
                  >
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    {issue.message}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--color-status-success)]/10 px-3 py-2 text-[12px] text-[var(--color-status-success)]">
                <CheckCircle className="size-3.5" />
                Workflow is valid
              </div>
            )}
          </div>

          {/* Graph canvas */}
          <div className="min-h-0 flex-1 px-5 pb-2 pt-4">
            <WorkflowGraphCanvas
              availableModels={availableModels}
              onEdgeSelect={setSelectedEdgeId}
              onGraphChange={emitGraphChange}
              onNodeSelect={setSelectedNodeId}
              selectedNodeId={selectedNodeId}
              workflow={workflow}
            />
          </div>

          {/* Settings below canvas */}
          <WorkflowSettingsPanel workflow={workflow} onChange={emitChange} />
        </div>

        {/* Right inspector */}
        <div className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface-1)]">
          <WorkflowGraphInspector
            availableModels={availableModels}
            onEdgeChange={handleEdgeChange}
            onEdgeRemove={handleEdgeRemove}
            onNodeChange={handleNodeChange}
            onNodeConfigChange={handleNodeConfigChange}
            onNodeRemove={handleNodeRemove}
            selectedEdgeId={selectedEdgeId}
            selectedNodeId={selectedNodeId}
            workflow={workflow}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Settings panel below canvas ───────────────────────────── */

function WorkflowSettingsPanel({
  workflow,
  onChange,
}: {
  workflow: WorkflowDefinition;
  onChange: (workflow: WorkflowDefinition) => void;
}) {
  return (
    <div className="shrink-0 border-t border-[var(--color-border)] px-5 py-4">
      <h4 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Settings
      </h4>
      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Name"
          onChange={(v) => onChange({ ...workflow, name: v })}
          placeholder="Workflow name"
          value={workflow.name}
        />
        <InputField
          label="Description"
          onChange={(v) => onChange({ ...workflow, description: v })}
          placeholder="What this workflow does"
          value={workflow.description}
        />

        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Execution Mode</span>
          <select
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50"
            onChange={(e) =>
              onChange({
                ...workflow,
                settings: { ...workflow.settings, executionMode: e.target.value as 'off-thread' | 'lockstep' },
              })
            }
            value={workflow.settings.executionMode}
          >
            <option value="off-thread">Off-thread</option>
            <option value="lockstep">Lockstep</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Max Iterations</span>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-200 focus:border-[var(--color-accent)]/50"
            min={1}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              onChange({
                ...workflow,
                settings: {
                  ...workflow.settings,
                  maxIterations: Number.isNaN(raw) ? undefined : raw,
                },
              });
            }}
            placeholder="e.g. 5"
            type="number"
            value={workflow.settings.maxIterations ?? ''}
          />
        </label>

        <div className="col-span-2 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3">
          <div>
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">Checkpointing</div>
            <p className="text-[12px] text-[var(--color-text-muted)]">Enable state checkpointing between steps</p>
          </div>
          <button
            className="cursor-pointer"
            onClick={() =>
              onChange({
                ...workflow,
                settings: {
                  ...workflow.settings,
                  checkpointing: { enabled: !workflow.settings.checkpointing.enabled },
                },
              })
            }
            type="button"
          >
            <ToggleSwitch enabled={workflow.settings.checkpointing.enabled} />
          </button>
        </div>
      </div>
    </div>
  );
}
