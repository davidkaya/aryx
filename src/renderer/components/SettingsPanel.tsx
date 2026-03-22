import { useState } from 'react';
import { ChevronLeft, ChevronRight, Cpu, Layers, Plus, Workflow } from 'lucide-react';

import type { ModelDefinition } from '@shared/domain/models';
import type { PatternDefinition } from '@shared/domain/pattern';
import type { SidecarCapabilities } from '@shared/contracts/sidecar';
import { CopilotStatusCard } from '@renderer/components/CopilotStatusCard';
import { PatternEditor } from '@renderer/components/PatternEditor';

interface SettingsPanelProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  patterns: PatternDefinition[];
  sidecarCapabilities?: SidecarCapabilities;
  isRefreshingCapabilities: boolean;
  onRefreshCapabilities: () => void;
  onClose: () => void;
  onSavePattern: (pattern: PatternDefinition) => Promise<void>;
  onDeletePattern: (patternId: string) => Promise<void>;
  onNewPattern: () => PatternDefinition;
}

type SettingsSection = 'connection' | 'patterns';

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'AI Provider',
    items: [
      { id: 'connection', label: 'Connection', icon: <Cpu className="size-3.5" /> },
    ],
  },
  {
    label: 'Orchestration',
    items: [
      { id: 'patterns', label: 'Patterns', icon: <Workflow className="size-3.5" /> },
    ],
  },
];

function modeBadgeClasses(pattern: PatternDefinition) {
  if (pattern.availability === 'unavailable') return 'bg-amber-500/10 text-amber-400';
  return 'bg-zinc-800 text-zinc-400';
}

export function SettingsPanel({
  availableModels,
  patterns,
  sidecarCapabilities,
  isRefreshingCapabilities,
  onRefreshCapabilities,
  onClose,
  onSavePattern,
  onDeletePattern,
  onNewPattern,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('connection');
  const [editingPattern, setEditingPattern] = useState<PatternDefinition | null>(null);

  // Pattern editor sub-view
  if (editingPattern) {
    const isBuiltin = editingPattern.id.startsWith('pattern-');
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
        <PatternEditor
          availableModels={availableModels}
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
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-3 pt-12">
        <button
          className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
      </div>

      {/* Two-column layout */}
      <div className="flex min-h-0 flex-1">
        {/* Left navigation */}
        <nav className="w-52 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
          <div className="space-y-4">
            {navGroups.map((group) => (
              <div key={group.label}>
                <span className="mb-1 block px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  {group.label}
                </span>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = item.id === activeSection;
                    return (
                      <button
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                          isActive
                            ? 'bg-zinc-800 font-medium text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
                        }`}
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        type="button"
                      >
                        <span className={isActive ? 'text-zinc-300' : 'text-zinc-500'}>{item.icon}</span>
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-6">
            {activeSection === 'connection' && (
              <ConnectionSection
                connection={sidecarCapabilities?.connection}
                isRefreshing={isRefreshingCapabilities}
                modelCount={sidecarCapabilities?.models.length ?? 0}
                onRefresh={onRefreshCapabilities}
              />
            )}
            {activeSection === 'patterns' && (
              <PatternsSection
                onEditPattern={(p) => setEditingPattern(structuredClone(p))}
                onNewPattern={() => setEditingPattern(onNewPattern())}
                patterns={patterns}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Section components ---------- */

function ConnectionSection({
  connection,
  modelCount,
  isRefreshing,
  onRefresh,
}: {
  connection?: SidecarCapabilities['connection'];
  modelCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="mb-1">
        <h3 className="text-sm font-semibold text-zinc-200">GitHub Copilot</h3>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Kopaya uses your installed GitHub Copilot CLI for AI capabilities
        </p>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-zinc-900/30 p-4">
        <CopilotStatusCard
          connection={connection}
          isRefreshing={isRefreshing}
          modelCount={modelCount}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}

function PatternsSection({
  patterns,
  onEditPattern,
  onNewPattern,
}: {
  patterns: PatternDefinition[];
  onEditPattern: (pattern: PatternDefinition) => void;
  onNewPattern: () => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Orchestration Patterns</h3>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Define reusable agent configurations for your sessions
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
          onClick={onNewPattern}
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
            onClick={() => onEditPattern(pattern)}
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
  );
}
