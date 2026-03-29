import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

import {
  findModel,
  inferProvider,
  modelCatalog,
  providerMeta,
  type ModelDefinition,
} from '@shared/domain/models';
import { reasoningEffortOptions, type ReasoningEffort } from '@shared/domain/pattern';

import { ProviderIcon } from './ProviderIcons';

function TierBadge({ tier }: { tier: ModelDefinition['tier'] }) {
  if (!tier) {
    return null;
  }

  const styles = {
    premium: 'bg-[var(--color-status-warning)]/10 text-[var(--color-status-warning)]',
    standard: 'bg-[var(--color-surface-3)]/50 text-[var(--color-text-muted)]',
    fast: 'bg-[var(--color-status-success)]/10 text-[var(--color-status-success)]',
  };

  return (
    <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium ${styles[tier]}`}>
      {tier}
    </span>
  );
}

interface ModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  models?: ReadonlyArray<ModelDefinition>;
  label?: string;
  disabled?: boolean;
}

export function ModelSelect({
  value,
  onChange,
  models = modelCatalog,
  label = 'Model',
  disabled = false,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selected = findModel(value, models);
  const provider = selected?.provider ?? inferProvider(value);
  const groupedModels = providerMeta
    .map((providerGroup) => ({
      ...providerGroup,
      models: models.filter((model) => model.provider === providerGroup.id),
    }))
    .filter((providerGroup) => providerGroup.models.length > 0);
  const otherModels = models.filter((model) => !model.provider);

  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      <div className="relative" ref={containerRef}>
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-200 hover:border-[var(--color-border)] focus:border-[var(--color-accent)]/50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {provider && <ProviderIcon provider={provider} />}
          <span className="flex-1 truncate">{selected?.name ?? (value || 'Select model')}</span>
          <ChevronDown
            className={`size-3.5 text-[var(--color-text-muted)] transition ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && !disabled && (
          <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] py-1 shadow-[0_16px_64px_rgba(0,0,0,0.5)]">
            {groupedModels.map((providerGroup) => {
              return (
                <div key={providerGroup.id}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                    <ProviderIcon provider={providerGroup.id} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      {providerGroup.label}
                    </span>
                  </div>
                  {providerGroup.models.map((model) => (
                    <button
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-all duration-200 hover:bg-[var(--color-surface-3)] ${
                        model.id === value ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]' : 'text-[var(--color-text-secondary)]'
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
            {otherModels.length > 0 && (
              <div>
                <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Other
                </div>
                {otherModels.map((model) => (
                  <button
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-all duration-200 hover:bg-[var(--color-surface-3)] ${
                      model.id === value ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]' : 'text-[var(--color-text-secondary)]'
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
            )}
          </div>
        )}
      </div>
    </label>
  );
}

interface ReasoningEffortSelectProps {
  value?: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  supportedEfforts?: ReadonlyArray<ReasoningEffort>;
  label?: string;
  disabled?: boolean;
}

export function ReasoningEffortSelect({
  value,
  onChange,
  supportedEfforts,
  label = 'Reasoning',
  disabled = false,
}: ReasoningEffortSelectProps) {
  const options = supportedEfforts
    ? reasoningEffortOptions.filter((option) => supportedEfforts.includes(option.value))
    : [...reasoningEffortOptions];
  const selectedValue = value && options.some((option) => option.value === value) ? value : options[0]?.value;

  if (supportedEfforts && supportedEfforts.length === 0) {
    return (
      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
        <div className="relative">
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 pr-9 text-[13px] text-[var(--color-text-muted)] outline-none"
            disabled
            readOnly
            value="Not supported for this model"
          />
          <Sparkles className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
        </div>
      </label>
    );
  }

  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      <div className="relative">
        <select
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || !selectedValue}
          onChange={(event) => onChange(event.target.value as ReasoningEffort)}
          value={selectedValue}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Sparkles className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
      </div>
    </label>
  );
}
