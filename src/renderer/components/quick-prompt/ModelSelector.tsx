import { useEffect, useRef, useMemo } from 'react';
import { Check, Crown, Zap, Brain } from 'lucide-react';

import type { ModelDefinition } from '@shared/domain/models';
import type { ReasoningEffort } from '@shared/domain/workflow';

interface ModelSelectorProps {
  models: ReadonlyArray<ModelDefinition>;
  selectedModelId?: string;
  selectedReasoning?: ReasoningEffort;
  onSelect: (model: ModelDefinition) => void;
  onReasoningChange: (effort: ReasoningEffort | undefined) => void;
  onClose: () => void;
}

const tierMeta: Record<string, { label: string; icon: typeof Crown; color: string; bg: string }> = {
  premium: { label: 'Premium', icon: Crown, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  standard: { label: 'Standard', icon: Zap, color: 'text-[var(--color-text-accent)]', bg: 'bg-[var(--color-accent-muted)]' },
  fast: { label: 'Fast', icon: Zap, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
};

const reasoningLevels: { value: ReasoningEffort; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Fast, concise' },
  { value: 'medium', label: 'Med', description: 'Balanced' },
  { value: 'high', label: 'High', description: 'Thorough' },
  { value: 'xhigh', label: 'Max', description: 'Exhaustive' },
];

interface ModelGroup {
  tier: string;
  label: string;
  models: ModelDefinition[];
}

export function ModelSelector({
  models,
  selectedModelId,
  selectedReasoning,
  onSelect,
  onReasoningChange,
  onClose,
}: ModelSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [onClose]);

  const selectedModel = models.find((m) => m.id === selectedModelId);
  const supportedEfforts = selectedModel?.supportedReasoningEfforts;

  // Group models by tier
  const groups = useMemo((): ModelGroup[] => {
    const tierOrder = ['premium', 'standard', 'fast', 'other'];
    const grouped = new Map<string, ModelDefinition[]>();

    for (const model of models) {
      const tier = model.tier ?? 'other';
      const list = grouped.get(tier) ?? [];
      list.push(model);
      grouped.set(tier, list);
    }

    return tierOrder
      .filter((t) => grouped.has(t))
      .map((tier) => ({
        tier,
        label: tier === 'other' ? 'Other' : tierMeta[tier]?.label ?? tier,
        models: grouped.get(tier)!,
      }));
  }, [models]);

  return (
    <div
      ref={containerRef}
      className="qp-dropdown-enter absolute bottom-full left-3 right-3 z-10 mb-1 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-2xl shadow-black/50"
      role="listbox"
      aria-label="Select model"
    >
      {/* Model list — grouped by tier */}
      <div className="max-h-[280px] overflow-y-auto overscroll-contain p-1.5">
        {groups.map((group, gi) => {
          const meta = tierMeta[group.tier];
          const TierIcon = meta?.icon;

          return (
            <div key={group.tier}>
              {gi > 0 && <div className="mx-2 my-1 border-t border-[var(--color-border-subtle)]/50" />}

              {/* Group header */}
              <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
                {TierIcon && <TierIcon className={`size-2.5 ${meta.color}`} />}
                <span className={`text-[10px] font-semibold tracking-wider uppercase ${meta?.color ?? 'text-[var(--color-text-muted)]'}`}>
                  {group.label}
                </span>
              </div>

              {/* Models in this group */}
              {group.models.map((model) => {
                const isSelected = model.id === selectedModelId;

                return (
                  <button
                    key={model.id}
                    onClick={() => onSelect(model)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-[7px] text-left transition-colors ${
                      isSelected
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]'
                    }`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span className="flex-1 truncate text-[12px] font-medium">{model.name}</span>

                    {model.supportedReasoningEfforts?.length ? (
                      <Brain className="size-3 flex-none text-[var(--color-text-muted)]/60" aria-label="Supports reasoning" />
                    ) : null}

                    {isSelected && <Check className="size-3.5 flex-none text-[var(--color-accent)]" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Reasoning effort — only shown when selected model supports it */}
      {supportedEfforts && supportedEfforts.length > 0 && (
        <div className="border-t border-[var(--color-border-subtle)] px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <Brain className="size-3 text-[var(--color-text-muted)]" />
            <span className="text-[10px] font-semibold tracking-wider text-[var(--color-text-muted)] uppercase">
              Reasoning Effort
            </span>
          </div>
          <div className="flex gap-1">
            {reasoningLevels
              .filter((lvl) => supportedEfforts.includes(lvl.value))
              .map((lvl) => {
                const isActive = selectedReasoning === lvl.value;
                return (
                  <button
                    key={lvl.value}
                    onClick={() => onReasoningChange(isActive ? undefined : lvl.value)}
                    className={`group flex-1 rounded-lg py-1.5 text-center transition-all ${
                      isActive
                        ? 'bg-[var(--color-accent)] text-white shadow-md shadow-[var(--color-accent)]/20'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]'
                    }`}
                    type="button"
                    title={lvl.description}
                  >
                    <span className="text-[11px] font-semibold">{lvl.label}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
