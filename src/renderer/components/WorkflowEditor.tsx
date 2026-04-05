import { Fragment, useCallback, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Download, Info, Plus, Trash2, Upload, X } from 'lucide-react';

import type { ModelDefinition } from '@shared/domain/models';
import type {
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowNodeKind,
  WorkflowEdge,
  AgentNodeConfig,
  SubWorkflowConfig,
  WorkflowStateScope,
} from '@shared/domain/workflow';
import { validateWorkflowDefinition } from '@shared/domain/workflow';
import { createId } from '@shared/utils/ids';
import { ToggleSwitch } from '@renderer/components/ui';

import { WorkflowGraphCanvas } from './workflow/WorkflowGraphCanvas';
import { ExportDropdown, ExportModal, ImportModal } from './workflow/WorkflowExportImportPanel';
import { WorkflowGraphInspector } from './workflow/WorkflowGraphInspector';
import { WorkflowNodePalette } from './workflow/WorkflowNodePalette';

interface WorkflowEditorProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  workflow: WorkflowDefinition;
  workflows: ReadonlyArray<WorkflowDefinition>;
  onChange: (workflow: WorkflowDefinition) => void;
  onDelete?: () => void;
  onSave: () => void;
  onBack: () => void;
  onExportWorkflow?: (format: 'yaml' | 'mermaid' | 'dot') => Promise<{ content: string }>;
  onImportWorkflow?: (content: string, format: 'yaml' | 'json') => Promise<WorkflowDefinition>;
}

interface WorkflowBreadcrumb {
  workflow: WorkflowDefinition;
  nodeId: string;
  nodeLabel: string;
  /** true when drilling into a referenced (not inline) workflow — view-only */
  readOnly: boolean;
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

/* ── Minimal inline workflow factory ────────────────────────── */

function createMinimalInlineWorkflow(): WorkflowDefinition {
  const now = new Date().toISOString();
  return {
    id: createId('inline-wf'),
    name: 'Inline Workflow',
    description: '',
    graph: {
      nodes: [
        { id: createId('wf-start'), kind: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { kind: 'start' } },
        { id: createId('wf-end'), kind: 'end', label: 'End', position: { x: 300, y: 0 }, config: { kind: 'end' } },
      ],
      edges: [],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
    },
    createdAt: now,
    updatedAt: now,
  };
}

/* ── Main editor ───────────────────────────────────────────── */

export function WorkflowEditor({
  availableModels,
  workflow,
  workflows,
  onChange,
  onDelete,
  onSave,
  onBack,
  onExportWorkflow,
  onImportWorkflow,
}: WorkflowEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<WorkflowBreadcrumb[]>([]);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exportResult, setExportResult] = useState<{ format: 'yaml' | 'mermaid' | 'dot'; content: string } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  /* ── Active workflow resolution ──────────────────────────── */

  const activeWorkflow = useMemo(() => {
    if (breadcrumbs.length === 0) return workflow;
    return breadcrumbs[breadcrumbs.length - 1].workflow;
  }, [workflow, breadcrumbs]);

  const isReadOnly = breadcrumbs.length > 0 && breadcrumbs[breadcrumbs.length - 1].readOnly;

  const issues = validateWorkflowDefinition(activeWorkflow);

  /* ── Change propagation ─────────────────────────────────── */

  function propagateActiveChange(updatedActive: WorkflowDefinition) {
    if (breadcrumbs.length === 0) {
      onChange(updatedActive);
      return;
    }

    // Walk back up the breadcrumb stack, embedding each level's workflow
    // into the parent's sub-workflow node config.
    let child = updatedActive;
    const newCrumbs = [...breadcrumbs];
    newCrumbs[newCrumbs.length - 1] = { ...newCrumbs[newCrumbs.length - 1], workflow: child };

    for (let i = newCrumbs.length - 1; i >= 0; i--) {
      const crumb = newCrumbs[i];
      const parent = i === 0 ? workflow : newCrumbs[i - 1].workflow;
      const updatedParent: WorkflowDefinition = {
        ...parent,
        graph: {
          ...parent.graph,
          nodes: parent.graph.nodes.map((n) => {
            if (n.id !== crumb.nodeId) return n;
            return {
              ...n,
              config: { kind: 'sub-workflow' as const, inlineWorkflow: child } satisfies SubWorkflowConfig,
            };
          }),
        },
      };
      child = updatedParent;
      if (i > 0) {
        newCrumbs[i - 1] = { ...newCrumbs[i - 1], workflow: updatedParent };
      }
    }

    setBreadcrumbs(newCrumbs);
    onChange(child);
  }

  function emitChange(next: WorkflowDefinition) {
    propagateActiveChange(next);
  }

  function emitGraphChange(graph: WorkflowGraph) {
    propagateActiveChange({ ...activeWorkflow, graph });
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
      ...activeWorkflow.graph,
      nodes: [...activeWorkflow.graph.nodes, newNode],
    });
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }

  function handleNodeChange(nodeId: string, patch: Partial<WorkflowNode>) {
    emitGraphChange({
      ...activeWorkflow.graph,
      nodes: activeWorkflow.graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    });
  }

  function handleNodeConfigChange(nodeId: string, config: WorkflowNodeConfig) {
    emitGraphChange({
      ...activeWorkflow.graph,
      nodes: activeWorkflow.graph.nodes.map((n) => (n.id === nodeId ? { ...n, config } : n)),
    });
  }

  function handleNodeRemove(nodeId: string) {
    const node = activeWorkflow.graph.nodes.find((n) => n.id === nodeId);
    if (!node || node.kind === 'start' || node.kind === 'end') {
      return;
    }

    emitGraphChange({
      nodes: activeWorkflow.graph.nodes.filter((n) => n.id !== nodeId),
      edges: activeWorkflow.graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    });
    setSelectedNodeId(null);
  }

  function handleEdgeChange(edgeId: string, patch: Partial<WorkflowEdge>) {
    emitGraphChange({
      ...activeWorkflow.graph,
      edges: activeWorkflow.graph.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
    });
  }

  function handleEdgeRemove(edgeId: string) {
    emitGraphChange({
      ...activeWorkflow.graph,
      edges: activeWorkflow.graph.edges.filter((e) => e.id !== edgeId),
    });
    setSelectedEdgeId(null);
  }

  /* ── Drill-down ─────────────────────────────────────────── */

  const handleDrillIntoSubWorkflow = useCallback(
    (node: WorkflowNode) => {
      if (node.config.kind !== 'sub-workflow') return;

      const config = node.config as SubWorkflowConfig;

      if (config.workflowId) {
        // Reference mode — find the referenced workflow and show it read-only
        const ref = workflows.find((wf) => wf.id === config.workflowId);
        if (!ref) return;
        setBreadcrumbs((prev) => [
          ...prev,
          { workflow: ref, nodeId: node.id, nodeLabel: node.label || 'Sub-Workflow', readOnly: true },
        ]);
      } else {
        // Inline mode — create a minimal workflow if needed, then drill in
        let inlineWf = config.inlineWorkflow;
        if (!inlineWf) {
          inlineWf = createMinimalInlineWorkflow();
          // Persist the new inline workflow into the node
          handleNodeConfigChange(node.id, { kind: 'sub-workflow', inlineWorkflow: inlineWf });
        }
        setBreadcrumbs((prev) => [
          ...prev,
          { workflow: inlineWf, nodeId: node.id, nodeLabel: node.label || 'Sub-Workflow', readOnly: false },
        ]);
      }
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [workflows, handleNodeConfigChange],
  );

  /* ── Breadcrumb sync: when the top-level workflow changes externally,
       re-resolve the breadcrumb stack from the current workflow to keep
       inline sub-workflows in sync. ──────────────────────────────────── */

  // Kept simple: if breadcrumbs exist and the innermost is inline,
  // re-resolve the active workflow from the current top-level workflow
  // so external saves don't desync. Referenced (read-only) crumbs
  // already point to a stable workflow object.
  useMemo(() => {
    if (breadcrumbs.length === 0) return;
    let current: WorkflowDefinition = workflow;
    const synced: WorkflowBreadcrumb[] = [];
    for (const crumb of breadcrumbs) {
      if (crumb.readOnly) {
        synced.push(crumb);
        continue;
      }
      const parentNode = current.graph.nodes.find((n) => n.id === crumb.nodeId);
      if (
        !parentNode ||
        parentNode.config.kind !== 'sub-workflow' ||
        !(parentNode.config as SubWorkflowConfig).inlineWorkflow
      ) {
        // Breadcrumb target no longer exists — pop remaining crumbs
        break;
      }
      const resolved = (parentNode.config as SubWorkflowConfig).inlineWorkflow!;
      synced.push({ ...crumb, workflow: resolved });
      current = resolved;
    }
    if (synced.length !== breadcrumbs.length || synced.some((s, i) => s.workflow !== breadcrumbs[i].workflow)) {
      setBreadcrumbs(synced);
    }
  }, [workflow]); // intentionally excluding breadcrumbs to avoid loops

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
          {onExportWorkflow && (
            <div className="relative">
              <button
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)]"
                onClick={() => setShowExportDropdown((prev) => !prev)}
                type="button"
                aria-expanded={showExportDropdown}
                aria-haspopup="listbox"
              >
                <Download className="size-3.5" />
                Export
              </button>
              {showExportDropdown && (
                <ExportDropdown
                  onSelectFormat={async (format) => {
                    const result = await onExportWorkflow(format);
                    setExportResult({ format, content: result.content });
                  }}
                  onClose={() => setShowExportDropdown(false)}
                />
              )}
            </div>
          )}
          {onImportWorkflow && (
            <button
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)]"
              onClick={() => setShowImportModal(true)}
              type="button"
            >
              <Upload className="size-3.5" />
              Import
            </button>
          )}
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

      {/* Breadcrumb bar */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-2">
          <button
            className="text-[12px] text-[var(--color-accent)] hover:underline"
            onClick={() => { setBreadcrumbs([]); setSelectedNodeId(null); setSelectedEdgeId(null); }}
            type="button"
          >
            {workflow.name || 'Untitled'}
          </button>
          {breadcrumbs.map((crumb, index) => (
            <Fragment key={`${crumb.nodeId}-${index}`}>
              <ChevronRight className="size-3 text-[var(--color-text-muted)]" />
              <button
                className={`text-[12px] ${
                  index === breadcrumbs.length - 1
                    ? 'font-medium text-[var(--color-text-primary)]'
                    : 'text-[var(--color-accent)] hover:underline'
                }`}
                onClick={() => { setBreadcrumbs(breadcrumbs.slice(0, index + 1)); setSelectedNodeId(null); setSelectedEdgeId(null); }}
                type="button"
              >
                {crumb.nodeLabel}
              </button>
            </Fragment>
          ))}
        </div>
      )}

      {/* Read-only banner for referenced sub-workflows */}
      {isReadOnly && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-2">
          <Info className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
          <span className="text-[12px] text-[var(--color-text-muted)]">
            This is a referenced workflow. Open it separately to edit.
          </span>
          <button
            className="ml-auto text-[12px] text-[var(--color-accent)] hover:underline"
            onClick={() => { setBreadcrumbs(breadcrumbs.slice(0, -1)); setSelectedNodeId(null); setSelectedEdgeId(null); }}
            type="button"
          >
            Go back
          </button>
        </div>
      )}

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
              workflow={activeWorkflow}
              workflows={workflows}
            />
          </div>

          {/* Settings below canvas */}
          {breadcrumbs.length === 0 && (
            <WorkflowSettingsPanel workflow={workflow} onChange={emitChange} />
          )}
        </div>

        {/* Right inspector */}
        <div className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface-1)]">
          <WorkflowGraphInspector
            availableModels={availableModels}
            onDrillIntoSubWorkflow={handleDrillIntoSubWorkflow}
            onEdgeChange={handleEdgeChange}
            onEdgeRemove={handleEdgeRemove}
            onNodeChange={handleNodeChange}
            onNodeConfigChange={handleNodeConfigChange}
            onNodeRemove={handleNodeRemove}
            selectedEdgeId={selectedEdgeId}
            selectedNodeId={selectedNodeId}
            validationIssues={issues}
            workflow={activeWorkflow}
            workflows={workflows}
          />
        </div>
      </div>

      {exportResult && (
        <ExportModal
          format={exportResult.format}
          content={exportResult.content}
          onClose={() => setExportResult(null)}
        />
      )}

      {showImportModal && onImportWorkflow && (
        <ImportModal
          onImport={async (content, format) => {
            const imported = await onImportWorkflow(content, format);
            onChange(imported);
            return imported;
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}

/* ── Settings panel below canvas ───────────────────────────── */

function StateScopeInitialValues({
  initialValues,
  onChange,
}: {
  initialValues: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(initialValues);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--color-text-muted)]">Initial Values</span>
        <button
          className="flex size-5 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
          onClick={() => {
            const key = `key${entries.length + 1}`;
            onChange({ ...initialValues, [key]: '' });
          }}
          title="Add initial value"
          type="button"
        >
          <Plus className="size-3" />
        </button>
      </div>
      {entries.map(([key, value]) => (
        <div className="flex items-center gap-1.5" key={key}>
          <input
            className="w-1/3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50"
            onChange={(e) => {
              const next = { ...initialValues };
              const val = next[key];
              delete next[key];
              next[e.target.value] = val;
              onChange(next);
            }}
            placeholder="key"
            value={key}
          />
          <input
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50"
            onChange={(e) => {
              onChange({ ...initialValues, [key]: e.target.value });
            }}
            placeholder="value"
            value={typeof value === 'string' ? value : JSON.stringify(value) ?? ''}
          />
          <button
            className="flex size-5 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
            onClick={() => {
              const next = { ...initialValues };
              delete next[key];
              onChange(next);
            }}
            title="Remove value"
            type="button"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

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

        {/* Telemetry */}
        <div className="col-span-2 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3">
          <div>
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">OpenTelemetry</div>
            <p className="text-[12px] text-[var(--color-text-muted)]">Export telemetry data via OpenTelemetry</p>
          </div>
          <button
            className="cursor-pointer"
            onClick={() =>
              onChange({
                ...workflow,
                settings: {
                  ...workflow.settings,
                  telemetry: {
                    ...workflow.settings.telemetry,
                    openTelemetry: !workflow.settings.telemetry?.openTelemetry,
                  },
                },
              })
            }
            type="button"
          >
            <ToggleSwitch enabled={workflow.settings.telemetry?.openTelemetry === true} />
          </button>
        </div>

        <div className="col-span-2 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3">
          <div>
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">Filter Sensitive Data</div>
            <p className="text-[12px] text-[var(--color-text-muted)]">Redact sensitive information from telemetry</p>
          </div>
          <button
            className="cursor-pointer"
            onClick={() =>
              onChange({
                ...workflow,
                settings: {
                  ...workflow.settings,
                  telemetry: {
                    ...workflow.settings.telemetry,
                    sensitiveData: !workflow.settings.telemetry?.sensitiveData,
                  },
                },
              })
            }
            type="button"
          >
            <ToggleSwitch enabled={workflow.settings.telemetry?.sensitiveData === true} />
          </button>
        </div>

        {/* State Scopes */}
        <div className="col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              State Scopes
            </span>
            <button
              className="flex size-6 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
              onClick={() => {
                const scopes = [...(workflow.settings.stateScopes ?? []), { name: '', description: '', initialValues: {} }];
                onChange({ ...workflow, settings: { ...workflow.settings, stateScopes: scopes } });
              }}
              title="Add state scope"
              type="button"
            >
              <Plus className="size-3.5" />
            </button>
          </div>

          {(workflow.settings.stateScopes ?? []).map((scope, idx) => (
            <div
              className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-3"
              key={idx}
            >
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50"
                  onChange={(e) => {
                    const scopes = [...(workflow.settings.stateScopes ?? [])];
                    scopes[idx] = { ...scopes[idx], name: e.target.value };
                    onChange({ ...workflow, settings: { ...workflow.settings, stateScopes: scopes } });
                  }}
                  placeholder="Scope name"
                  value={scope.name}
                />
                <button
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
                  onClick={() => {
                    const scopes = (workflow.settings.stateScopes ?? []).filter((_, i) => i !== idx);
                    onChange({ ...workflow, settings: { ...workflow.settings, stateScopes: scopes } });
                  }}
                  title="Remove scope"
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </div>
              <input
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50"
                onChange={(e) => {
                  const scopes = [...(workflow.settings.stateScopes ?? [])];
                  scopes[idx] = { ...scopes[idx], description: e.target.value };
                  onChange({ ...workflow, settings: { ...workflow.settings, stateScopes: scopes } });
                }}
                placeholder="Description (optional)"
                value={scope.description ?? ''}
              />
              <StateScopeInitialValues
                initialValues={scope.initialValues ?? {}}
                onChange={(initialValues) => {
                  const scopes = [...(workflow.settings.stateScopes ?? [])];
                  scopes[idx] = { ...scopes[idx], initialValues };
                  onChange({ ...workflow, settings: { ...workflow.settings, stateScopes: scopes } });
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
