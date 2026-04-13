import { useEffect, useRef } from 'react';
import { Check, Crown, Zap } from 'lucide-react';

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

const tierConfig = {
  premium: { label: 'Premium', icon: Crown, className: 'text-amber-400 bg-amber-400/10' },
  standard: { label: 'Standard', icon: Zap, className: 'text-[var(--color-text-accent)] bg-[var(--color-accent-muted)]' },
  fast: { label: 'Fast', icon: Zap, className: 'text-emerald-400 bg-emerald-400/10' },
} as const;

const reasoningOptions: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

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
  const supportedReasoningEfforts = selectedModel?.supportedReasoningEfforts;

  return (
    <div
      ref={containerRef}
      className="qp-dropdown-enter absolute bottom-0 left-4 right-4 z-10 translate-y-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-xl shadow-black/40"
      role="listbox"
      aria-label="Select model"
    >
      {/* Model list */}
      <div className="max-h-[240px] overflow-y-auto p-1.5">
        {models.map((model) => {
          const isSelected = model.id === selectedModelId;
          const tier = model.tier ? tierConfig[model.tier] : undefined;
          const TierIcon = tier?.icon;

          return (
            <button
              key={model.id}
              onClick={() => onSelect(model)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                isSelected
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]'
              }`}
              type="button"
              role="option"
              aria-selected={isSelected}
            >
              <span className="flex-1 text-[12px] font-medium">{model.name}</span>

              {tier && TierIcon && (
                <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${tier.className}`}>
                  <TierIcon className="size-2.5" />
                  {tier.label}
                </span>
              )}

              {isSelected && <Check className="size-3.5 flex-none text-[var(--color-accent)]" />}
            </button>
          );
        })}
      </div>

      {/* Reasoning effort selector */}
      {supportedReasoningEfforts && supportedReasoningEfforts.length > 0 && (
        <div className="border-t border-[var(--color-border-subtle)] p-3">
          <p className="mb-2 text-[10px] font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Reasoning Effort
          </p>
          <div className="flex gap-1">
            {reasoningOptions
              .filter((opt) => supportedReasoningEfforts.includes(opt.value))
              .map((opt) => {
                const isActive = selectedReasoning === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => onReasoningChange(isActive ? undefined : opt.value)}
                    className={`flex-1 rounded-md py-1 text-[11px] font-medium transition ${
                      isActive
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]'
                    }`}
                    type="button"
                  >
                    {opt.label}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
