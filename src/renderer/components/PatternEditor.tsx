import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  validatePatternDefinition,
  type OrchestrationMode,
  type PatternDefinition,
  type ReasoningEffort,
  type PatternAgentDefinition,
} from '@shared/domain/pattern';
import {
  modelCatalog,
  providerMeta,
  findModel,
  inferProvider,
  type ModelDefinition,
} from '@shared/domain/models';

interface PatternEditorProps {
  pattern: PatternDefinition;
  isBuiltin: boolean;
  onChange: (pattern: PatternDefinition) => void;
  onDelete?: () => void;
  onSave: () => void;
  onBack: () => void;
}

const reasoningEfforts: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Maximum' },
];

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

import { ProviderIcon } from './ProviderIcons';

function TierBadge({ tier }: { tier: ModelDefinition['tier'] }) {
  const styles = {
    premium: 'bg-amber-500/10 text-amber-400',
    standard: 'bg-zinc-700/50 text-zinc-500',
    fast: 'bg-emerald-500/10 text-emerald-400',
  };
  return (
    <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium ${styles[tier]}`}>
      {tier}
    </span>
  );
}

function ModelSelect({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selected = findModel(value);
  const provider = selected?.provider ?? inferProvider(value);

  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-zinc-400">Model</span>
      <div className="relative" ref={containerRef}>
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-[13px] text-zinc-100 outline-none transition hover:border-zinc-600 focus:border-indigo-500/50"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {provider && <ProviderIcon provider={provider} />}
          <span className="flex-1 truncate">{selected?.name ?? (value || 'Select model')}</span>
          <ChevronDown
            className={`size-3.5 text-zinc-500 transition ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
            {providerMeta.map((p) => {
              const models = modelCatalog.filter((m) => m.provider === p.id);
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                    <ProviderIcon provider={p.id} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {p.label}
                    </span>
                  </div>
                  {models.map((model) => (
                    <button
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-zinc-800 ${
                        model.id === value
                          ? 'bg-indigo-500/10 text-indigo-200'
                          : 'text-zinc-300'
                      }`}
                      key={model.id}
                      onClick={() => {
                        onChange(model.id);
                        setOpen(false);
                      }}
                      type="button"
                    >
                      <span className="flex-1">{model.name}</span>
                      <TierBadge tier={model.tier} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </label>
  );
}

export function PatternEditor({ pattern, isBuiltin, onChange, onDelete, onSave, onBack }: PatternEditorProps) {
  const issues = validatePatternDefinition(pattern);

  function updateAgent(agentId: string, patch: Partial<PatternAgentDefinition>) {
    onChange({
      ...pattern,
      agents: pattern.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — top padding clears the title bar overlay zone */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 pb-3 pt-12">
        <div className="flex items-center gap-3">
          <button
            className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onBack}
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {pattern.name || 'Untitled pattern'}
            </h3>
            <p className="text-[12px] text-zinc-500">
              {isBuiltin ? 'Built-in pattern' : 'Custom pattern'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
                      onChange={(v) => updateAgent(agent.id, { model: v })}
                      value={agent.model}
                    />
                    <label className="block space-y-1.5">
                      <span className="text-[12px] font-medium text-zinc-400">Reasoning</span>
                      <select
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none transition focus:border-indigo-500/50"
                        onChange={(e) =>
                          updateAgent(agent.id, {
                            reasoningEffort: e.target.value as ReasoningEffort,
                          })
                        }
                        value={agent.reasoningEffort ?? 'high'}
                      >
                        {reasoningEfforts.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
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
        </div>
      </div>
    </div>
  );
}
