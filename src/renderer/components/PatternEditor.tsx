import { AlertCircle, CheckCircle, ChevronLeft, Plus, Trash2 } from 'lucide-react';

import { validatePatternDefinition, type OrchestrationMode, type PatternDefinition } from '@shared/domain/pattern';

interface PatternEditorProps {
  pattern: PatternDefinition;
  isBuiltin: boolean;
  onChange: (pattern: PatternDefinition) => void;
  onDelete?: () => void;
  onSave: () => void;
  onBack: () => void;
}

const modes: OrchestrationMode[] = ['single', 'sequential', 'concurrent', 'handoff', 'group-chat', 'magentic'];

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

export function PatternEditor({ pattern, isBuiltin, onChange, onDelete, onSave, onBack }: PatternEditorProps) {
  const issues = validatePatternDefinition(pattern);

  function updateAgent(agentId: string, patch: Record<string, string>) {
    onChange({
      ...pattern,
      agents: pattern.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
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
        <div className="mx-auto max-w-2xl space-y-6">
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

          {/* Basic fields */}
          <section className="space-y-4">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              General
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField
                label="Name"
                onChange={(v) => onChange({ ...pattern, name: v })}
                placeholder="Pattern name"
                value={pattern.name}
              />
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-zinc-400">Mode</span>
                <select
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none transition focus:border-indigo-500/50"
                  onChange={(e) =>
                    onChange({ ...pattern, mode: e.target.value as OrchestrationMode })
                  }
                  value={pattern.mode}
                >
                  {modes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <InputField
              label="Description"
              multiline
              onChange={(v) => onChange({ ...pattern, description: v })}
              placeholder="What this pattern does..."
              value={pattern.description}
            />
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
                      },
                    ],
                  })
                }
                type="button"
              >
                <Plus className="size-3" />
                Add
              </button>
            </div>

            <div className="space-y-3">
              {pattern.agents.map((agent, index) => (
                <div
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                  key={agent.id}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[12px] font-medium text-zinc-500">
                      Agent {index + 1}
                    </span>
                    {pattern.agents.length > 1 && (
                      <button
                        className="text-[12px] text-zinc-600 transition hover:text-red-400"
                        onClick={() =>
                          onChange({
                            ...pattern,
                            agents: pattern.agents.filter((a) => a.id !== agent.id),
                          })
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InputField
                      label="Name"
                      onChange={(v) => updateAgent(agent.id, { name: v })}
                      value={agent.name}
                    />
                    <InputField
                      label="Model"
                      onChange={(v) => updateAgent(agent.id, { model: v })}
                      placeholder="e.g. gpt-5.4"
                      value={agent.model}
                    />
                    <div className="sm:col-span-2">
                      <InputField
                        label="Description"
                        onChange={(v) => updateAgent(agent.id, { description: v })}
                        value={agent.description}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <InputField
                        label="Instructions"
                        multiline
                        onChange={(v) => updateAgent(agent.id, { instructions: v })}
                        placeholder="System prompt for this agent..."
                        value={agent.instructions}
                      />
                    </div>
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
