import { useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle,
  ChevronLeft,
  GitFork,
  ListOrdered,
  Lock,
  MessageSquare,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { ApprovalCheckpointKind, ApprovalPolicy } from '@shared/domain/approval';
import type { ModelDefinition } from '@shared/domain/models';
import {
  addAgentToGraph,
  removeAgentFromGraph,
  resolvePatternGraph,
  syncPatternGraph,
  validatePatternDefinition,
  type OrchestrationMode,
  type PatternDefinition,
  type PatternAgentDefinition,
  type PatternGraph,
} from '@shared/domain/pattern';
import {
  listApprovalToolDefinitions,
  type ApprovalToolDefinition,
  type ApprovalToolKind,
  type RuntimeToolDefinition,
  type WorkspaceToolingSettings,
} from '@shared/domain/tooling';

import { ToggleSwitch } from '@renderer/components/ui';
import { PatternGraphCanvas } from './pattern-graph/PatternGraphCanvas';
import { PatternGraphInspector } from './pattern-graph/PatternGraphInspector';

interface PatternEditorProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  pattern: PatternDefinition;
  isBuiltin: boolean;
  toolingSettings: WorkspaceToolingSettings;
  runtimeTools?: ReadonlyArray<RuntimeToolDefinition>;
  onChange: (pattern: PatternDefinition) => void;
  onDelete?: () => void;
  onSave: () => void;
  onBack: () => void;
}

interface ModeInfo {
  icon: LucideIcon;
  label: string;
  description: string;
}

const modeInfo: Record<OrchestrationMode, ModeInfo> = {
  single: {
    icon: MessageSquare,
    label: 'Single',
    description: 'Direct conversation with one agent',
  },
  sequential: {
    icon: ListOrdered,
    label: 'Sequential',
    description: 'Agents process in order, each refining the result',
  },
  concurrent: {
    icon: GitFork,
    label: 'Concurrent',
    description: 'Multiple agents respond in parallel',
  },
  handoff: {
    icon: ArrowLeftRight,
    label: 'Handoff',
    description: 'Triage agent routes to specialists',
  },
  'group-chat': {
    icon: Users,
    label: 'Group Chat',
    description: 'Agents iterate in managed round-robin',
  },
  magentic: {
    icon: Lock,
    label: 'Magentic',
    description: 'Not yet available in .NET',
  },
};

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

export function PatternEditor({
  availableModels,
  pattern,
  isBuiltin,
  toolingSettings,
  runtimeTools,
  onChange,
  onDelete,
  onSave,
  onBack,
}: PatternEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const issues = validatePatternDefinition(pattern);
  const graph = resolvePatternGraph(pattern);

  function emitChange(nextPattern: PatternDefinition) {
    onChange({ ...nextPattern, graph: resolvePatternGraph(nextPattern) });
  }

  function emitModeChange(nextPattern: PatternDefinition) {
    onChange(syncPatternGraph(nextPattern));
  }

  function emitGraphChange(nextGraph: PatternGraph) {
    onChange({ ...pattern, graph: nextGraph });
  }

  function addAgent() {
    const newAgent: PatternAgentDefinition = {
      id: `agent-${crypto.randomUUID()}`,
      name: `Agent ${pattern.agents.length + 1}`,
      description: '',
      instructions: '',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    };
    const updatedGraph = addAgentToGraph(graph, pattern.mode, newAgent);
    onChange({ ...pattern, agents: [...pattern.agents, newAgent], graph: updatedGraph });
  }

  function updateAgent(agentId: string, patch: Partial<PatternAgentDefinition>) {
    emitChange({
      ...pattern,
      agents: pattern.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
    });
  }

  function removeAgent(agentId: string) {
    if (pattern.agents.length <= 1) {
      return;
    }

    const updatedGraph = removeAgentFromGraph(graph, pattern.mode, agentId);
    onChange({
      ...pattern,
      agents: pattern.agents.filter((a) => a.id !== agentId),
      graph: updatedGraph,
    });
    setSelectedNodeId(null);
  }

  function updateApprovalPolicy(updater: (current: ApprovalPolicy | undefined) => ApprovalPolicy | undefined) {
    emitChange({ ...pattern, approvalPolicy: updater(pattern.approvalPolicy) });
  }

  function isCheckpointEnabled(kind: ApprovalCheckpointKind): boolean {
    return pattern.approvalPolicy?.rules.some((r) => r.kind === kind) ?? false;
  }

  function checkpointAgentIds(kind: ApprovalCheckpointKind): string[] | undefined {
    return pattern.approvalPolicy?.rules.find((r) => r.kind === kind)?.agentIds;
  }

  function toggleCheckpoint(kind: ApprovalCheckpointKind, enabled: boolean) {
    updateApprovalPolicy((current) => {
      const otherRules = (current?.rules ?? []).filter((r) => r.kind !== kind);
      if (!enabled) {
        return { rules: otherRules };
      }
      return { rules: [...otherRules, { kind }] };
    });
  }

  function setCheckpointAgentScope(kind: ApprovalCheckpointKind, agentIds: string[] | undefined) {
    updateApprovalPolicy((current) => {
      const rules = (current?.rules ?? []).map((r) =>
        r.kind === kind ? { ...r, agentIds } : r,
      );
      return { rules };
    });
  }

  const approvalTools = listApprovalToolDefinitions(toolingSettings, runtimeTools);
  const autoApprovedSet = new Set(pattern.approvalPolicy?.autoApprovedToolNames ?? []);

  function toggleToolAutoApproval(toolId: string) {
    const current = new Set(pattern.approvalPolicy?.autoApprovedToolNames ?? []);
    if (current.has(toolId)) {
      current.delete(toolId);
    } else {
      current.add(toolId);
    }
    updateApprovalPolicy((policy) => ({
      rules: policy?.rules ?? [],
      autoApprovedToolNames: current.size > 0 ? [...current] : undefined,
    }));
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
              {pattern.name || 'Untitled pattern'}
            </h3>
            <p className="text-[12px] text-[var(--color-text-muted)]">
              {isBuiltin ? 'Built-in pattern' : 'Custom pattern'}
            </p>
          </div>
        </div>
        <div className="no-drag flex items-center gap-2">
          {!isBuiltin && onDelete && (
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

      {/* Body — graph canvas + inspector split */}
      <div className="flex min-h-0 flex-1">
        {/* Left column: graph canvas + settings below */}
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
                Pattern is valid
              </div>
            )}
          </div>

          {/* Graph canvas */}
          <div className="flex items-center justify-between px-5 pt-4">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Topology
            </h4>
            <button
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
              onClick={addAgent}
              type="button"
            >
              <Plus className="size-3" />
              Add agent
            </button>
          </div>

          <div className="min-h-[300px] flex-1 px-5 py-3">
            <PatternGraphCanvas
              pattern={pattern}
              availableModels={availableModels}
              onGraphChange={emitGraphChange}
              onAgentRemove={removeAgent}
              onNodeSelect={setSelectedNodeId}
              selectedNodeId={selectedNodeId}
            />
          </div>

          {/* Scrollable settings below graph */}
          <div className="max-h-[45%] overflow-y-auto border-t border-[var(--color-border-subtle)] px-5 py-5">
            <div className="space-y-8">
              {/* General */}
              <section className="space-y-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  General
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <InputField
                    label="Name"
                    onChange={(v) => emitChange({ ...pattern, name: v })}
                    placeholder="Pattern name"
                    value={pattern.name}
                  />
                  <InputField
                    label="Description"
                    onChange={(v) => emitChange({ ...pattern, description: v })}
                    placeholder="What this pattern does..."
                    value={pattern.description}
                  />
                </div>
              </section>

              {/* Mode selector */}
              <section className="space-y-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Orchestration Mode
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(modeInfo) as OrchestrationMode[]).map((mode) => {
                    const info = modeInfo[mode];
                    const Icon = info.icon;
                    const selected = pattern.mode === mode;
                    const disabled = mode === 'magentic';

                    return (
                      <button
                        className={`flex flex-col rounded-xl border p-2.5 text-left transition-all duration-200 ${
                          selected
                            ? 'border-[var(--color-border-glow)] bg-[var(--color-accent-muted)] ring-1 ring-[var(--color-border-glow)]'
                            : disabled
                              ? 'cursor-not-allowed border-[var(--color-border-subtle)] opacity-40'
                              : 'border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-glass)]'
                        }`}
                        disabled={disabled}
                        key={mode}
                        onClick={() => emitModeChange({ ...pattern, mode })}
                        type="button"
                      >
                        <div className="flex items-center gap-1.5">
                          <Icon
                            className={`size-3.5 ${selected ? 'text-[var(--color-text-accent)]' : 'text-[var(--color-text-muted)]'}`}
                          />
                          <span
                            className={`text-[11px] font-semibold ${
                              selected ? 'text-[var(--color-text-accent)]' : 'text-[var(--color-text-secondary)]'
                            }`}
                          >
                            {info.label}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] leading-snug text-[var(--color-text-muted)]">
                          {info.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Approval checkpoints */}
              <section className="space-y-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Approval Checkpoints
                </h4>

                <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                </p>

                <div className="space-y-3">
                  <ApprovalCheckpointRow
                    agents={pattern.agents}
                    enabled={isCheckpointEnabled('tool-call')}
                    kind="tool-call"
                    label="Tool call approval"
                    description="Require approval before the agent executes tool calls"
                    onToggle={(enabled) => toggleCheckpoint('tool-call', enabled)}
                    scopedAgentIds={checkpointAgentIds('tool-call')}
                    onScopeChange={(agentIds) => setCheckpointAgentScope('tool-call', agentIds)}
                  >
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Auto-approved tools
                    </div>
                    <p className="mb-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                      Tools marked as auto-approved will skip manual review.
                      Sessions can override these defaults from the Activity panel.
                    </p>
                    {approvalTools.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-[var(--color-text-muted)]">
                        No tools available yet. Connect MCP servers or wait for runtime capabilities to load.
                      </p>
                    ) : (
                      <ToolApprovalGroupedList
                        autoApprovedSet={autoApprovedSet}
                        onToggle={toggleToolAutoApproval}
                        tools={approvalTools}
                      />
                    )}
                  </ApprovalCheckpointRow>
                  <ApprovalCheckpointRow
                    agents={pattern.agents}
                    enabled={isCheckpointEnabled('final-response')}
                    kind="final-response"
                    label="Final response review"
                    description="Review and approve assistant messages before publication"
                    onToggle={(enabled) => toggleCheckpoint('final-response', enabled)}
                    scopedAgentIds={checkpointAgentIds('final-response')}
                    onScopeChange={(agentIds) => setCheckpointAgentScope('final-response', agentIds)}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* Right column: node inspector */}
        <div className="w-[320px] shrink-0 overflow-y-auto border-l border-[var(--color-border-subtle)] bg-[var(--color-glass)]">
          <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Inspector
            </h4>
          </div>
          <PatternGraphInspector
            availableModels={availableModels}
            agents={pattern.agents}
            graph={graph}
            mode={pattern.mode}
            selectedNodeId={selectedNodeId}
            onAgentChange={updateAgent}
            onAgentRemove={removeAgent}
            onGraphChange={emitGraphChange}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Approval checkpoint row ───────────────────────────────── */

function ApprovalCheckpointRow({
  agents,
  children,
  enabled,
  kind: _kind,
  label,
  description,
  onToggle,
  scopedAgentIds,
  onScopeChange,
}: {
  agents: PatternAgentDefinition[];
  children?: React.ReactNode;
  enabled: boolean;
  kind: ApprovalCheckpointKind;
  label: string;
  description: string;
  onToggle: (enabled: boolean) => void;
  scopedAgentIds: string[] | undefined;
  onScopeChange: (agentIds: string[] | undefined) => void;
}){
  const isAllAgents = !scopedAgentIds || scopedAgentIds.length === 0;

  function toggleAgentScope(agentId: string) {
    const current = scopedAgentIds ?? [];
    const next = current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId];
    onScopeChange(next.length > 0 ? next : undefined);
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] p-4">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => onToggle(!enabled)} type="button">
        <ShieldCheck className={`size-4 shrink-0 ${enabled ? 'text-[var(--color-text-accent)]' : 'text-[var(--color-text-muted)]'}`} />
        <div className="min-w-0 flex-1">
          <span className="text-[12px] font-medium text-[var(--color-text-primary)]">{label}</span>
          <p className="text-[11px] text-[var(--color-text-muted)]">{description}</p>
        </div>
        <ToggleSwitch enabled={enabled} />
      </button>

      {/* Agent scope selector */}
      {enabled && agents.length > 1 && (
        <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">Scope</span>
            <button
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all duration-200 ${
                isAllAgents
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]'
                  : 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
              onClick={() => onScopeChange(undefined)}
              type="button"
            >
              All agents
            </button>
            <button
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all duration-200 ${
                !isAllAgents
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]'
                  : 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
              onClick={() => onScopeChange([])}
              type="button"
            >
              Selected agents
            </button>
          </div>

          {!isAllAgents && (
            <div className="flex flex-wrap gap-1.5">
              {agents.map((agent) => {
                const isSelected = scopedAgentIds?.includes(agent.id) ?? false;
                return (
                  <button
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-200 ${
                      isSelected
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)] ring-1 ring-[var(--color-border-glow)]'
                        : 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]'
                    }`}
                    key={agent.id}
                    onClick={() => toggleAgentScope(agent.id)}
                    type="button"
                  >
                    {agent.name || 'Unnamed'}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Optional additional content (e.g. tool auto-approval list) */}
      {enabled && children && (
        <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Tool auto-approval grouped list ───────────────────────── */

const approvalKindOrder: ApprovalToolKind[] = ['builtin', 'mcp', 'lsp', 'mixed'];
const approvalKindLabels: Record<ApprovalToolKind, string> = {
  builtin: 'Built-in',
  mcp: 'MCP Servers',
  lsp: 'Language Servers',
  mixed: 'Other',
};

function ToolApprovalGroupedList({
  tools,
  autoApprovedSet,
  onToggle,
}: {
  tools: ApprovalToolDefinition[];
  autoApprovedSet: Set<string>;
  onToggle: (toolId: string) => void;
}) {
  const groups = approvalKindOrder
    .map((kind) => ({ kind, tools: tools.filter((t) => t.kind === kind) }))
    .filter((g) => g.tools.length > 0);
  const showHeaders = groups.length > 1;

  return (
    <div>
      {groups.map((group, i) => (
        <div key={group.kind}>
          {showHeaders && (
            <div className={`text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] ${i > 0 ? 'mt-3' : ''} mb-1`}>
              {approvalKindLabels[group.kind]}
            </div>
          )}
          {group.tools.map((tool) => (
            <ToolApprovalToggleRow
              enabled={autoApprovedSet.has(tool.id)}
              key={tool.id}
              onToggle={() => onToggle(tool.id)}
              tool={tool}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ToolApprovalToggleRow({
  tool,
  enabled,
  onToggle,
}: {
  tool: ApprovalToolDefinition;
  enabled: boolean;
  onToggle: () => void;
}) {
  const detail = tool.description || (tool.providerNames.length > 0 ? tool.providerNames.join(', ') : undefined);
  return (
    <button
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-all duration-200 hover:bg-[var(--color-surface-3)]/60"
      onClick={onToggle}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <span className="truncate text-[12px] font-medium text-[var(--color-text-secondary)]">{tool.label}</span>
        {detail && <div className="truncate text-[10px] text-[var(--color-text-muted)]">{detail}</div>}
      </div>
      <ToggleSwitch enabled={enabled} />
    </button>
  );
}
