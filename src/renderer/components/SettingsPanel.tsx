import { useState } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';

import type { PatternDefinition } from '@shared/domain/pattern';
import { PatternEditor } from '@renderer/components/PatternEditor';

interface SettingsPanelProps {
  patterns: PatternDefinition[];
  onClose: () => void;
  onSavePattern: (pattern: PatternDefinition) => Promise<void>;
  onDeletePattern: (patternId: string) => Promise<void>;
  onNewPattern: () => PatternDefinition;
}

function modeBadgeClasses(pattern: PatternDefinition) {
  if (pattern.availability === 'unavailable') return 'bg-amber-500/10 text-amber-400';
  return 'bg-zinc-800 text-zinc-400';
}

export function SettingsPanel({
  patterns,
  onClose,
  onSavePattern,
  onDeletePattern,
  onNewPattern,
}: SettingsPanelProps) {
  const [editingPattern, setEditingPattern] = useState<PatternDefinition | null>(null);

  if (editingPattern) {
    const isBuiltin = editingPattern.id.startsWith('pattern-');
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
        <PatternEditor
          isBuiltin={isBuiltin}
          onBack={() => setEditingPattern(null)}
          onChange={setEditingPattern}
          onDelete={
            isBuiltin
              ? undefined
              : async () => {
                  await onDeletePattern(editingPattern.id);
                  setEditingPattern(null);
                }
          }
          onSave={async () => {
            await onSavePattern(editingPattern);
            setEditingPattern(null);
          }}
          pattern={editingPattern}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
      {/* Header — top padding clears the title bar overlay zone */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 pb-3 pt-12">
        <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
        <button
          className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Orchestration Patterns</h3>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                Define reusable agent configurations for your sessions
              </p>
            </div>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
              onClick={() => setEditingPattern(onNewPattern())}
              type="button"
            >
              <Plus className="size-3.5" />
              New Pattern
            </button>
          </div>

          <div className="space-y-1">
            {patterns.map((pattern) => (
              <button
                className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition hover:border-zinc-800 hover:bg-zinc-900"
                key={pattern.id}
                onClick={() => setEditingPattern(structuredClone(pattern))}
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-zinc-200">{pattern.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${modeBadgeClasses(pattern)}`}>
                      {pattern.mode}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-zinc-500">{pattern.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-zinc-600">
                    {pattern.agents.length} agent{pattern.agents.length === 1 ? '' : 's'}
                  </span>
                  <ChevronRight className="size-4 text-zinc-700 transition group-hover:text-zinc-500" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
