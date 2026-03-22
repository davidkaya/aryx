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

interface ModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  label?: string;
  disabled?: boolean;
}

export function ModelSelect({
  value,
  onChange,
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

  const selected = findModel(value);
  const provider = selected?.provider ?? inferProvider(value);

  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-zinc-400">{label}</span>
      <div className="relative" ref={containerRef}>
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-[13px] text-zinc-100 outline-none transition hover:border-zinc-600 focus:border-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {provider && <ProviderIcon provider={provider} />}
          <span className="flex-1 truncate">{selected?.name ?? (value || 'Select model')}</span>
          <ChevronDown
            className={`size-3.5 text-zinc-500 transition ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && !disabled && (
          <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
            {providerMeta.map((providerGroup) => {
              const models = modelCatalog.filter((model) => model.provider === providerGroup.id);

              return (
                <div key={providerGroup.id}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                    <ProviderIcon provider={providerGroup.id} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {providerGroup.label}
                    </span>
                  </div>
                  {models.map((model) => (
                    <button
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-zinc-800 ${
                        model.id === value ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-300'
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

interface ReasoningEffortSelectProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  label?: string;
  disabled?: boolean;
}

export function ReasoningEffortSelect({
  value,
  onChange,
  label = 'Reasoning',
  disabled = false,
}: ReasoningEffortSelectProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-zinc-400">{label}</span>
      <div className="relative">
        <select
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 pr-9 text-[13px] text-zinc-100 outline-none transition focus:border-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as ReasoningEffort)}
          value={value}
        >
          {reasoningEffortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Sparkles className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
      </div>
    </label>
  );
}
