import { useCallback, useMemo } from 'react';
import { AlertCircle, Bot, FunctionSquare, GitBranch, Info, Link2, Radio, RotateCcw, Trash2, Unlink } from 'lucide-react';

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
  WorkflowOrchestrationMode,
  WorkflowValidationIssue,
  AgentNodeConfig,
  WorkflowAgentOverrides,
} from '@shared/domain/workflow';
import { isBuilderBasedMode } from '@shared/domain/workflow';
import type { WorkspaceAgentDefinition } from '@shared/domain/workspaceAgent';
import { ModelSelect, ReasoningEffortSelect } from '@renderer/components/AgentConfigFields';
import { InvokeFunctionInspector } from '@renderer/components/workflow/InvokeFunctionInspector';
import { ConditionEditor } from '@renderer/components/workflow/ConditionEditor';
import { RequestPortInspector } from '@renderer/components/workflow/RequestPortInspector';
import { SubWorkflowInspector } from '@renderer/components/workflow/SubWorkflowInspector';

interface WorkflowGraphInspectorProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>;
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

const inputBaseClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50';

const selectClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50';

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
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      {multiline ? (
        <textarea
          className={`${inputBaseClass} min-h-20 resize-y`}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      ) : (
        <input
          className={inputBaseClass}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      )}
    </label>
  );
}

/* ── Overridable field ─────────────────────────────────────── */

function OverridableField({
  label,
  baseValue,
  overrideValue,
  onChange,
  onReset,
  multiline,
  placeholder,
}: {
  label: string;
  baseValue: string;
  overrideValue: string | undefined;
  onChange: (value: string) => void;
  onReset: () => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const isOverridden = overrideValue !== undefined;
  const displayValue = overrideValue ?? baseValue;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
        {isOverridden && (
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10"
            onClick={onReset}
            title="Reset to saved agent value"
            type="button"
          >
            <RotateCcw className="size-2.5" />
            Reset
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          className={`${inputBaseClass} min-h-20 resize-y ${isOverridden ? 'border-[var(--color-accent)]/30' : ''}`}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? baseValue}
          value={displayValue}
        />
      ) : (
        <input
          className={`${inputBaseClass} ${isOverridden ? 'border-[var(--color-accent)]/30' : ''}`}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? baseValue}
          value={displayValue}
        />
      )}
    </div>
  );
}

/* ── Agent node inspector ──────────────────────────────────── */

function AgentNodeInspector({
  node,
  availableModels,
  workspaceAgents,
  onNodeChange,
  onNodeConfigChange,
  onNodeRemove,
}: {
  node: WorkflowNode;
  availableModels: ReadonlyArray<ModelDefinition>;
  workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>;
  onNodeChange: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onNodeConfigChange: (nodeId: string, config: WorkflowNodeConfig) => void;
  onNodeRemove: (nodeId: string) => void;
}) {
  const config = node.config as AgentNodeConfig;
  const isLinked = !!config.workspaceAgentId;
  const baseAgent = useMemo(
    () => isLinked ? workspaceAgents.find((a) => a.id === config.workspaceAgentId) : undefined,
    [isLinked, config.workspaceAgentId, workspaceAgents],
  );
  const isStale = isLinked && !baseAgent;

  const resolvedModel = isLinked && baseAgent
    ? config.overrides?.model ?? baseAgent.model
    : config.model;
  const model = findModel(resolvedModel, availableModels);

  function setConfig(next: AgentNodeConfig) {
    onNodeConfigChange(node.id, next);
  }

  function patchConfig(patch: Partial<AgentNodeConfig>) {
    setConfig({ ...config, ...patch });
  }

  function patchOverride<K extends keyof WorkflowAgentOverrides>(
    field: K,
    value: WorkflowAgentOverrides[K],
  ) {
    if (!baseAgent) return;
    const baseValue = baseAgent[field];
    if (value === baseValue) {
      // Value matches base — remove the override
      resetOverride(field);
    } else {
      setConfig({
        ...config,
        overrides: { ...config.overrides, [field]: value },
      });
    }
  }

  function resetOverride(field: keyof WorkflowAgentOverrides) {
    if (!config.overrides) return;
    const { [field]: _, ...rest } = config.overrides;
    const cleaned = Object.keys(rest).length > 0 ? rest : undefined;
    setConfig({ ...config, overrides: cleaned });
  }

  function handleSelectWorkspaceAgent(agentId: string) {
    const agent = workspaceAgents.find((a) => a.id === agentId);
    if (!agent) return;
    setConfig({
      ...config,
      workspaceAgentId: agentId,
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      copilot: agent.copilot,
      overrides: undefined,
    });
    onNodeChange(node.id, { label: agent.name });
  }

  function handleDetach() {
    if (!baseAgent) return;
    const overrides = config.overrides ?? {};
    setConfig({
      ...config,
      workspaceAgentId: undefined,
      overrides: undefined,
      name: overrides.name ?? baseAgent.name,
      description: overrides.description ?? baseAgent.description,
      instructions: overrides.instructions ?? baseAgent.instructions,
      model: overrides.model ?? baseAgent.model,
      reasoningEffort: overrides.reasoningEffort ?? baseAgent.reasoningEffort,
    });
  }

  function handleSwitchToLinked() {
    if (workspaceAgents.length === 0) return;
    handleSelectWorkspaceAgent(workspaceAgents[0].id);
  }

  const displayName = isLinked && baseAgent
    ? config.overrides?.name ?? baseAgent.name
    : config.name;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
            <Bot className="size-4 text-[var(--color-text-primary)]" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {displayName || 'Unnamed Agent'}
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

      {/* Source selector */}
      <div className="space-y-1.5">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Source</span>
        <div className="flex gap-1">
          <button
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all ${
              !isLinked
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/25'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]'
            }`}
            onClick={() => { if (isLinked) handleDetach(); }}
            type="button"
          >
            Inline
          </button>
          <button
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all ${
              isLinked
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/25'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]'
            }`}
            onClick={() => { if (!isLinked) handleSwitchToLinked(); }}
            type="button"
          >
            <Link2 className="size-3" />
            Saved Agent
          </button>
        </div>
      </div>

      {/* Workspace agent picker (linked mode) */}
      {isLinked && (
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Agent</span>
          {workspaceAgents.length > 0 ? (
            <select
              className={selectClass}
              onChange={(e) => handleSelectWorkspaceAgent(e.target.value)}
              value={config.workspaceAgentId ?? ''}
            >
              {isStale && (
                <option disabled value={config.workspaceAgentId}>
                  (Deleted agent)
                </option>
              )}
              {workspaceAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
              No saved agents. Create agents in Settings → Agents.
            </p>
          )}

          {isStale && (
            <div className="flex items-start gap-1.5 rounded-lg bg-[var(--color-status-warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-status-warning)]">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span>The linked agent was deleted. Select another or switch to inline.</span>
            </div>
          )}

          {baseAgent && (
            <button
              className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] transition hover:text-[var(--color-text-secondary)]"
              onClick={handleDetach}
              title="Detach from saved agent and use inline configuration"
              type="button"
            >
              <Unlink className="size-3" />
              Detach to inline
            </button>
          )}
        </div>
      )}

      {/* Label field (always shown) */}
      <InputField
        label="Label"
        onChange={(v) => onNodeChange(node.id, { label: v })}
        placeholder="Display label"
        value={node.label}
      />

      {/* Inline mode — direct editing */}
      {!isLinked && (
        <>
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
        </>
      )}

      {/* Linked mode — overridable fields */}
      {isLinked && baseAgent && (
        <>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            Configuration inherited from <strong className="text-[var(--color-text-secondary)]">{baseAgent.name}</strong>. Edit fields below to override per-node.
          </div>

          <OverridableField
            baseValue={baseAgent.name}
            label="Agent Name"
            onChange={(v) => patchOverride('name', v)}
            onReset={() => resetOverride('name')}
            overrideValue={config.overrides?.name}
            placeholder="Agent name"
          />
          <OverridableField
            baseValue={baseAgent.description}
            label="Description"
            onChange={(v) => patchOverride('description', v)}
            onReset={() => resetOverride('description')}
            overrideValue={config.overrides?.description}
            placeholder="What this agent does"
          />
          <OverridableField
            baseValue={baseAgent.instructions}
            label="Instructions"
            multiline
            onChange={(v) => patchOverride('instructions', v)}
            onReset={() => resetOverride('instructions')}
            overrideValue={config.overrides?.instructions}
            placeholder="System instructions for this agent"
          />

          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Model</span>
                {config.overrides?.model !== undefined && (
                  <button
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10"
                    onClick={() => resetOverride('model')}
                    title="Reset to saved agent value"
                    type="button"
                  >
                    <RotateCcw className="size-2.5" />
                    Reset
                  </button>
                )}
              </div>
              <ModelSelect
                models={availableModels}
                onChange={(value) => {
                  const m = findModel(value, availableModels);
                  patchOverride('model', value);
                  patchOverride('reasoningEffort', resolveReasoningEffort(m, config.overrides?.reasoningEffort ?? baseAgent.reasoningEffort));
                }}
                value={resolvedModel}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Reasoning</span>
                {config.overrides?.reasoningEffort !== undefined && (
                  <button
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10"
                    onClick={() => resetOverride('reasoningEffort')}
                    title="Reset to saved agent value"
                    type="button"
                  >
                    <RotateCcw className="size-2.5" />
                    Reset
                  </button>
                )}
              </div>
              <ReasoningEffortSelect
                label=""
                onChange={(value) => patchOverride('reasoningEffort', value)}
                supportedEfforts={getSupportedReasoningEfforts(model)}
                value={config.overrides?.reasoningEffort ?? baseAgent.reasoningEffort}
              />
              <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                Controls how much the model reasons before responding. Higher values produce more careful, thorough answers.
              </p>
            </div>
          </div>
        </>
      )}
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
  orchestrationMode,
  validationIssues,
  onEdgeChange,
  onEdgeRemove,
}: {
  edge: WorkflowEdge;
  orchestrationMode?: WorkflowOrchestrationMode;
  validationIssues?: WorkflowValidationIssue[];
  onEdgeChange: (edgeId: string, patch: Partial<WorkflowEdge>) => void;
  onEdgeRemove: (edgeId: string) => void;
}) {
  const isFanIn = edge.kind === 'fan-in';
  const builderMode = isBuilderBasedMode(orchestrationMode);
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
              disabled={builderMode}
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
            {builderMode
              ? 'Loop edges are managed by the orchestration mode settings.'
              : 'Creates an iterative cycle, re-executing the path between these nodes up to a set limit.'}
          </p>
        </div>
        {edge.isLoop && (
          <label className="block space-y-1.5">
            <span className="text-[11px] text-[var(--color-text-muted)]">Max Iterations</span>
            <input
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50 disabled:opacity-60"
              disabled={builderMode}
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
            {builderMode && (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Derived from the {orchestrationMode === 'group-chat' ? 'Max Rounds' : 'Max Iterations'} setting.
              </p>
            )}
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
  workspaceAgents,
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
          orchestrationMode={workflow.settings.orchestrationMode}
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
          workspaceAgents={workspaceAgents}
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
