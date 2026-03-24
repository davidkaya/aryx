import { type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle,
  ChevronDown,
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
import {
  findModel,
  getSupportedReasoningEfforts,
  resolveReasoningEffort,
  type ModelDefinition,
} from '@shared/domain/models';
import {
  validatePatternDefinition,
  type OrchestrationMode,
  type PatternDefinition,
  type PatternAgentDefinition,
} from '@shared/domain/pattern';
import {
  listApprovalToolDefinitions,
  type ApprovalToolDefinition,
  type RuntimeToolDefinition,
  type WorkspaceToolingSettings,
} from '@shared/domain/tooling';

import { ModelSelect, ReasoningEffortSelect } from './AgentConfigFields';

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

function FlowPill({ children, variant = 'agent' }: { children: ReactNode; variant?: 'user' | 'agent' }) {
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none ${
        variant === 'user'
          ? 'bg-indigo-500/20 text-indigo-400'
          : 'bg-zinc-700/60 text-zinc-400'
      }`}
    >
      {children}
    </span>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return <span className="text-[10px] leading-none text-zinc-600">{label ?? '→'}</span>;
}

function ModeFlowDiagram({ mode }: { mode: OrchestrationMode }) {
  switch (mode) {
    case 'single':
      return (
        <div className="flex items-center gap-1">
          <FlowPill variant="user">You</FlowPill>
          <FlowArrow />
          <FlowPill>Agent</FlowPill>
          <FlowArrow />
          <FlowPill variant="user">You</FlowPill>
        </div>
      );
    case 'sequential':
      return (
        <div className="flex items-center gap-1">
          <FlowPill>A₁</FlowPill>
          <FlowArrow />
          <FlowPill>A₂</FlowPill>
          <FlowArrow />
          <FlowPill>A₃</FlowPill>
        </div>
      );
    case 'concurrent':
      return (
        <div className="flex items-center gap-1">
          <FlowPill variant="user">You</FlowPill>
          <FlowArrow />
          <div className="flex gap-0.5">
            <FlowPill>A₁</FlowPill>
            <FlowPill>A₂</FlowPill>
            <FlowPill>A₃</FlowPill>
          </div>
          <FlowArrow />
          <FlowPill variant="user">You</FlowPill>
        </div>
      );
    case 'handoff':
      return (
        <div className="flex items-center gap-1">
          <FlowPill>Triage</FlowPill>
          <FlowArrow label="⇄" />
          <FlowPill>S₁</FlowPill>
          <FlowPill>S₂</FlowPill>
        </div>
      );
    case 'group-chat':
      return (
        <div className="flex items-center gap-1">
          <FlowPill>A₁</FlowPill>
          <FlowArrow label="⇄" />
          <FlowPill>A₂</FlowPill>
          <FlowArrow label="⇄" />
          <FlowPill>A₃</FlowPill>
        </div>
      );
    case 'magentic':
      return <span className="text-[10px] italic text-zinc-700">Coming soon</span>;
    default:
      return null;
  }
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
    'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500/50';
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-zinc-400">{label}</span>
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
  const issues = validatePatternDefinition(pattern);

  function updateAgent(agentId: string, patch: Partial<PatternAgentDefinition>) {
    onChange({
      ...pattern,
      agents: pattern.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
    });
  }

  function updateAgentModel(agent: PatternAgentDefinition, modelId: string) {
    const model = findModel(modelId, availableModels);
    updateAgent(agent.id, {
      model: modelId,
      reasoningEffort: resolveReasoningEffort(model, agent.reasoningEffort),
    });
  }

  function updateApprovalPolicy(updater: (current: ApprovalPolicy | undefined) => ApprovalPolicy | undefined) {
    onChange({ ...pattern, approvalPolicy: updater(pattern.approvalPolicy) });
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
        return otherRules.length > 0 ? { rules: otherRules } : undefined;
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
      {/* Header — consistent ← navigation */}
      <div className="drag-region flex items-center justify-between border-b border-[var(--color-border)] px-5 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <button
            className="no-drag flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onBack}
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div>
            <h3 className="text-[13px] font-semibold text-zinc-100">
              {pattern.name || 'Untitled pattern'}
            </h3>
            <p className="text-[12px] text-zinc-500">
              {isBuiltin ? 'Built-in pattern' : 'Custom pattern'}
            </p>
          </div>
        </div>
        <div className="no-drag flex items-center gap-2">
          {!isBuiltin && onDelete && (
            <button
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-red-400 transition hover:bg-red-500/10"
              onClick={onDelete}
              type="button"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          )}
          <button
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-indigo-500"
            onClick={onSave}
            type="button"
          >
            Save
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* Validation banner */}
          {issues.length > 0 ? (
            <div className="space-y-2">
              {issues.map((issue, i) => (
                <div
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ${
                    issue.level === 'error'
                      ? 'bg-red-500/10 text-red-300'
                      : 'bg-amber-500/10 text-amber-300'
                  }`}
                  key={`${issue.field ?? 'v'}-${i}`}
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  {issue.message}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
              <CheckCircle className="size-3.5" />
              Pattern is valid and ready to use
            </div>
          )}

          {/* Name + description */}
          <section className="space-y-4">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              General
            </h4>
            <InputField
              label="Name"
              onChange={(v) => onChange({ ...pattern, name: v })}
              placeholder="Pattern name"
              value={pattern.name}
            />
            <InputField
              label="Description"
              multiline
              onChange={(v) => onChange({ ...pattern, description: v })}
              placeholder="What this pattern does..."
              value={pattern.description}
            />
          </section>

          {/* Mode selector cards */}
          <section className="space-y-4">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              Orchestration Mode
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(modeInfo) as OrchestrationMode[]).map((mode) => {
                const info = modeInfo[mode];
                const Icon = info.icon;
                const selected = pattern.mode === mode;
                const disabled = mode === 'magentic';

                return (
                  <button
                    className={`flex flex-col rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-indigo-500/40 bg-indigo-500/5 ring-1 ring-indigo-500/20'
                        : disabled
                          ? 'cursor-not-allowed border-zinc-800/50 opacity-40'
                          : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/60'
                    }`}
                    disabled={disabled}
                    key={mode}
                    onClick={() => onChange({ ...pattern, mode })}
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`size-4 ${selected ? 'text-indigo-400' : 'text-zinc-500'}`}
                      />
                      <span
                        className={`text-[12px] font-semibold ${
                          selected ? 'text-indigo-200' : 'text-zinc-300'
                        }`}
                      >
                        {info.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                      {info.description}
                    </p>
                    <div className="mt-2.5">
                      <ModeFlowDiagram mode={mode} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Agents */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
                Agents ({pattern.agents.length})
              </h4>
              <button
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() =>
                  onChange({
                    ...pattern,
                    agents: [
                      ...pattern.agents,
                      {
                        id: `agent-${crypto.randomUUID()}`,
                        name: `Agent ${pattern.agents.length + 1}`,
                        description: '',
                        instructions: '',
                        model: 'gpt-5.4',
                        reasoningEffort: 'high',
                      },
                    ],
                  })
                }
                type="button"
              >
                <Plus className="size-3" />
                Add agent
              </button>
            </div>

            <div className="space-y-3">
              {pattern.agents.map((agent, index) => (
                <div
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                  key={agent.id}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded bg-zinc-700/60 text-[10px] font-bold text-zinc-400">
                        {index + 1}
                      </span>
                      <span className="text-[12px] font-medium text-zinc-300">
                        {agent.name || 'Unnamed agent'}
                      </span>
                    </div>
                    {pattern.agents.length > 1 && (
                      <button
                        className="flex items-center gap-1 text-[12px] text-zinc-600 transition hover:text-red-400"
                        onClick={() =>
                          onChange({
                            ...pattern,
                            agents: pattern.agents.filter((a) => a.id !== agent.id),
                          })
                        }
                        type="button"
                      >
                        <Trash2 className="size-3" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <InputField
                      label="Name"
                      onChange={(v) => updateAgent(agent.id, { name: v })}
                      value={agent.name}
                    />
                    <ModelSelect
                      models={availableModels}
                      onChange={(value) => updateAgentModel(agent, value)}
                      value={agent.model}
                    />
                    <ReasoningEffortSelect
                      label="Reasoning"
                      onChange={(value) => updateAgent(agent.id, { reasoningEffort: value })}
                      supportedEfforts={getSupportedReasoningEfforts(findModel(agent.model, availableModels))}
                      value={resolveReasoningEffort(findModel(agent.model, availableModels), agent.reasoningEffort)}
                    />
                  </div>
                  <div className="mt-3">
                    <InputField
                      label="Description"
                      onChange={(v) => updateAgent(agent.id, { description: v })}
                      placeholder="What this agent does..."
                      value={agent.description}
                    />
                  </div>
                  <div className="mt-3">
                    <InputField
                      label="Instructions"
                      multiline
                      onChange={(v) => updateAgent(agent.id, { instructions: v })}
                      placeholder="System prompt for this agent..."
                      value={agent.instructions}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Approval checkpoints */}
          <section className="space-y-4">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              Approval Checkpoints
            </h4>

            <p className="text-[11px] leading-relaxed text-zinc-600">
              Pause the run for human review before risky actions or publishing responses.
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
              />
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

          {/* Tool auto-approval defaults */}
          <section className="space-y-4">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              Tool Auto-Approval Defaults
            </h4>

            <p className="text-[11px] leading-relaxed text-zinc-600">
              When tool-call approval is enabled, these tools will be auto-approved without manual review.
              Sessions can override these defaults from the Activity panel.
            </p>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
              {approvalTools.length === 0 ? (
                <p className="py-2 text-center text-[11px] text-zinc-600">
                  No approval-capable runtime tools are currently available.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {approvalTools.map((tool) => (
                    <ToolApprovalToggleRow
                      enabled={autoApprovedSet.has(tool.id)}
                      key={tool.id}
                      onToggle={() => toggleToolAutoApproval(tool.id)}
                      tool={tool}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Toggle switch ─────────────────────────────────────────── */

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-indigo-500' : 'bg-zinc-700'
      }`}
      onClick={onToggle}
      type="button"
    >
      <span
        className={`inline-block size-[14px] rounded-full bg-white shadow-sm transition-transform ${
          enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

/* ── Approval checkpoint row ───────────────────────────────── */

function ApprovalCheckpointRow({
  agents,
  enabled,
  kind: _kind,
  label,
  description,
  onToggle,
  scopedAgentIds,
  onScopeChange,
}: {
  agents: PatternAgentDefinition[];
  enabled: boolean;
  kind: ApprovalCheckpointKind;
  label: string;
  description: string;
  onToggle: (enabled: boolean) => void;
  scopedAgentIds: string[] | undefined;
  onScopeChange: (agentIds: string[] | undefined) => void;
}) {
  const isAllAgents = !scopedAgentIds || scopedAgentIds.length === 0;

  function toggleAgentScope(agentId: string) {
    const current = scopedAgentIds ?? [];
    const next = current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId];
    onScopeChange(next.length > 0 ? next : undefined);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-3">
        <ShieldCheck className={`size-4 shrink-0 ${enabled ? 'text-indigo-400' : 'text-zinc-600'}`} />
        <div className="min-w-0 flex-1">
          <span className="text-[12px] font-medium text-zinc-200">{label}</span>
          <p className="text-[11px] text-zinc-500">{description}</p>
        </div>
        <ToggleSwitch enabled={enabled} onToggle={() => onToggle(!enabled)} />
      </div>

      {/* Agent scope selector */}
      {enabled && agents.length > 1 && (
        <div className="mt-3 border-t border-zinc-800/50 pt-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-400">Scope</span>
            <button
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                isAllAgents
                  ? 'bg-indigo-500/15 text-indigo-300'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-400'
              }`}
              onClick={() => onScopeChange(undefined)}
              type="button"
            >
              All agents
            </button>
            <button
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                !isAllAgents
                  ? 'bg-indigo-500/15 text-indigo-300'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-400'
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
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      isSelected
                        ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30'
                        : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-400'
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
    </div>
  );
}

/* ── Tool auto-approval toggle row ─────────────────────────── */

function ToolApprovalToggleRow({
  tool,
  enabled,
  onToggle,
}: {
  tool: ApprovalToolDefinition;
  enabled: boolean;
  onToggle: () => void;
}) {
  const kindBadge = tool.kind === 'builtin'
    ? 'Built-in'
    : tool.kind === 'lsp'
      ? 'LSP'
      : tool.kind === 'mcp'
        ? 'MCP'
        : 'Mixed';
  return (
    <button
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-800/60"
      onClick={onToggle}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-zinc-300">{tool.label}</span>
          <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-zinc-500">
            {kindBadge}
          </span>
        </div>
        {(tool.description || tool.providerNames.length > 0) && (
          <div className="truncate text-[10px] text-zinc-600">
            {tool.description ?? tool.providerNames.join(', ')}
          </div>
        )}
      </div>
      <ToggleSwitch enabled={enabled} onToggle={onToggle} />
    </button>
  );
}
