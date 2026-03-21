import { validatePatternDefinition, type OrchestrationMode, type PatternDefinition } from '@shared/domain/pattern';

interface PatternEditorProps {
  pattern: PatternDefinition;
  isBuiltin: boolean;
  onChange: (pattern: PatternDefinition) => void;
  onDelete?: () => void;
  onSave: () => void;
}

const modes: OrchestrationMode[] = ['single', 'sequential', 'concurrent', 'handoff', 'group-chat', 'magentic'];

export function PatternEditor({ pattern, isBuiltin, onChange, onDelete, onSave }: PatternEditorProps) {
  const issues = validatePatternDefinition(pattern);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Pattern</div>
            <h2 className="mt-2 text-2xl font-semibold text-white">{pattern.name || 'Untitled pattern'}</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Define a reusable orchestration blueprint that can be launched against any project in the
              workspace.
            </p>
          </div>
          <div className="flex gap-3">
            {!isBuiltin && onDelete ? (
              <button
                className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/10"
                onClick={onDelete}
                type="button"
              >
                Delete
              </button>
            ) : null}
            <button
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
              onClick={onSave}
              type="button"
            >
              Save Pattern
            </button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_320px] gap-0 overflow-hidden">
        <div className="overflow-y-auto px-8 py-6">
          <div className="space-y-8">
            <section className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  onChange={(event) => onChange({ ...pattern, name: event.target.value })}
                  value={pattern.name}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Mode</span>
                <select
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  onChange={(event) =>
                    onChange({
                      ...pattern,
                      mode: event.target.value as OrchestrationMode,
                    })
                  }
                  value={pattern.mode}
                >
                  {modes.map((mode) => (
                    <option
                      key={mode}
                      value={mode}
                    >
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-200">Description</span>
                <textarea
                  className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  onChange={(event) => onChange({ ...pattern, description: event.target.value })}
                  value={pattern.description}
                />
              </label>
            </section>

            <section>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Agents</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Configure the participating Copilot-backed agents and their model selections.
                  </p>
                </div>
                <button
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800"
                  onClick={() =>
                    onChange({
                      ...pattern,
                      agents: [
                        ...pattern.agents,
                        {
                          id: `agent-${crypto.randomUUID()}`,
                          name: `Agent ${pattern.agents.length + 1}`,
                          description: 'New participant',
                          instructions: 'You are a helpful specialist in this orchestration.',
                          model: 'gpt-5.4',
                        },
                      ],
                    })
                  }
                  type="button"
                >
                  Add Agent
                </button>
              </div>

              <div className="space-y-4">
                {pattern.agents.map((agent, index) => (
                  <div
                    className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
                    key={agent.id}
                  >
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div className="text-sm font-medium text-slate-200">Agent {index + 1}</div>
                      {pattern.agents.length > 1 ? (
                        <button
                          className="text-sm text-rose-200 hover:text-rose-100"
                          onClick={() =>
                            onChange({
                              ...pattern,
                              agents: pattern.agents.filter((current) => current.id !== agent.id),
                            })
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-slate-300">Name</span>
                        <input
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          onChange={(event) =>
                            onChange({
                              ...pattern,
                              agents: pattern.agents.map((current) =>
                                current.id === agent.id ? { ...current, name: event.target.value } : current,
                              ),
                            })
                          }
                          value={agent.name}
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-slate-300">Model</span>
                        <input
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          onChange={(event) =>
                            onChange({
                              ...pattern,
                              agents: pattern.agents.map((current) =>
                                current.id === agent.id ? { ...current, model: event.target.value } : current,
                              ),
                            })
                          }
                          value={agent.model}
                        />
                      </label>
                      <label className="space-y-2 md:col-span-2">
                        <span className="text-sm font-medium text-slate-300">Description</span>
                        <input
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          onChange={(event) =>
                            onChange({
                              ...pattern,
                              agents: pattern.agents.map((current) =>
                                current.id === agent.id ? { ...current, description: event.target.value } : current,
                              ),
                            })
                          }
                          value={agent.description}
                        />
                      </label>
                      <label className="space-y-2 md:col-span-2">
                        <span className="text-sm font-medium text-slate-300">Instructions</span>
                        <textarea
                          className="min-h-28 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          onChange={(event) =>
                            onChange({
                              ...pattern,
                              agents: pattern.agents.map((current) =>
                                current.id === agent.id ? { ...current, instructions: event.target.value } : current,
                              ),
                            })
                          }
                          value={agent.instructions}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <aside className="border-l border-slate-800 bg-slate-900/70 px-6 py-6">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Validation</h3>
          <div className="mt-4 space-y-3">
            {issues.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                This pattern is ready to launch.
              </div>
            ) : (
              issues.map((issue, index) => (
                <div
                  className={`rounded-xl px-4 py-3 text-sm ${
                    issue.level === 'error'
                      ? 'border border-rose-500/40 bg-rose-500/10 text-rose-200'
                      : 'border border-amber-500/40 bg-amber-500/10 text-amber-200'
                  }`}
                  key={`${issue.field ?? 'issue'}-${index}`}
                >
                  <div className="font-medium">{issue.level.toUpperCase()}</div>
                  <div className="mt-1">{issue.message}</div>
                </div>
              ))
            )}

            {isBuiltin ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-400">
                Built-in patterns can be edited and saved, but they cannot be deleted from the global library.
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
