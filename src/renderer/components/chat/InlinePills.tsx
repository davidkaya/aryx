import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

import { ProviderIcon } from '@renderer/components/ProviderIcons';
import { PopoverToggleRow } from '@renderer/components/ui';
import { useClickOutside } from '@renderer/hooks/useClickOutside';
import type { ApprovalToolDefinition, ApprovalToolKind, LspProfileDefinition, McpServerDefinition, SessionToolingSelection } from '@shared/domain/tooling';
import { findModel, inferProvider, providerMeta, type ModelDefinition } from '@shared/domain/models';
import { reasoningEffortOptions, type ReasoningEffort } from '@shared/domain/pattern';
import { RotateCcw, Server, ShieldCheck } from 'lucide-react';

/* ── Tier badge ────────────────────────────────────────────── */

function TierBadge({ tier }: { tier: ModelDefinition['tier'] }) {
  if (!tier) return null;
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

/* ── Helpers ────────────────────────────────────────────────── */

function toggleInArray(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((currentId) => currentId !== id)
    : [...current, id];
}

/* ── InlineModelPill ───────────────────────────────────────── */

export function InlineModelPill({
  value,
  models,
  onChange,
  disabled,
}: {
  value: string;
  models: ReadonlyArray<ModelDefinition>;
  onChange: (model: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  const selected = findModel(value, models);
  const provider = selected?.provider ?? inferProvider(value);
  const displayName = selected?.name ?? value ?? 'Model';

  const groupedModels = providerMeta
    .map((pg) => ({ ...pg, models: models.filter((m) => m.provider === pg.id) }))
    .filter((pg) => pg.models.length > 0);
  const otherModels = models.filter((m) => !m.provider);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] leading-none font-medium transition ${
          open
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
            : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {provider && <ProviderIcon provider={provider} className="size-2.5" />}
        <span className="max-w-[100px] truncate">{displayName}</span>
        <ChevronDown className={`size-2.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-72 w-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl" role="listbox">
          {groupedModels.map((pg) => (
            <div key={pg.id}>
              <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                <ProviderIcon provider={pg.id} className="size-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {pg.label}
                </span>
              </div>
              {pg.models.map((model) => (
                <button
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-zinc-800 ${
                    model.id === value ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-300'
                  }`}
                  key={model.id}
                  onClick={() => { onChange(model.id); setOpen(false); }}
                  role="option"
                  aria-selected={model.id === value}
                  type="button"
                >
                  <span className="flex-1">{model.name}</span>
                  <TierBadge tier={model.tier} />
                </button>
              ))}
            </div>
          ))}
          {otherModels.length > 0 && (
            <div>
              <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Other
              </div>
              {otherModels.map((model) => (
                <button
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-zinc-800 ${
                    model.id === value ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-300'
                  }`}
                  key={model.id}
                  onClick={() => { onChange(model.id); setOpen(false); }}
                  role="option"
                  aria-selected={model.id === value}
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
  );
}

/* ── InlineThinkingPill ────────────────────────────────────── */

export function InlineThinkingPill({
  value,
  supportedEfforts,
  onChange,
  disabled,
}: {
  value?: ReasoningEffort;
  supportedEfforts?: ReadonlyArray<ReasoningEffort>;
  onChange: (effort: ReasoningEffort) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  const options = supportedEfforts
    ? reasoningEffortOptions.filter((o) => supportedEfforts.includes(o.value))
    : [...reasoningEffortOptions];

  if (supportedEfforts && supportedEfforts.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-zinc-800/40 bg-zinc-800/20 px-1.5 py-0.5 text-[8px] leading-none text-zinc-600">
        <Sparkles className="size-2.5" />
        N/A
      </span>
    );
  }

  const currentLabel = options.find((o) => o.value === value)?.label ?? value ?? 'Thinking';

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] leading-none font-medium transition ${
          open
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
            : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Sparkles className="size-2.5" />
        <span>{currentLabel}</span>
        <ChevronDown className={`size-2.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 w-36 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl" role="listbox">
          {options.map((option) => (
            <button
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-zinc-800 ${
                option.value === value ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-300'
              }`}
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
              role="option"
              aria-selected={option.value === value}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── InlineToolsPill ───────────────────────────────────────── */

export function InlineToolsPill({
  mcpServers,
  lspProfiles,
  selection,
  disabled,
  onToggle,
}: {
  mcpServers: ReadonlyArray<McpServerDefinition>;
  lspProfiles: ReadonlyArray<LspProfileDefinition>;
  selection: SessionToolingSelection;
  disabled: boolean;
  onToggle: (selection: SessionToolingSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  const enabledCount = selection.enabledMcpServerIds.length + selection.enabledLspProfileIds.length;
  const totalCount = mcpServers.length + lspProfiles.length;

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] leading-none font-medium transition ${
          open
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
            : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Server className="size-2.5" />
        <span>{enabledCount}/{totalCount} tools</span>
        <ChevronDown className={`size-2.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 w-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
          {mcpServers.length > 0 && (
            <div>
              <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                MCP Servers
              </div>
              {mcpServers.map((server) => (
                <PopoverToggleRow
                  detail={server.transport === 'local' ? server.command : server.url}
                  enabled={selection.enabledMcpServerIds.includes(server.id)}
                  key={server.id}
                  label={server.name}
                  onToggle={() =>
                    onToggle({
                      ...selection,
                      enabledMcpServerIds: toggleInArray(selection.enabledMcpServerIds, server.id),
                    })
                  }
                />
              ))}
            </div>
          )}
          {lspProfiles.length > 0 && (
            <div>
              <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                Language Servers
              </div>
              {lspProfiles.map((profile) => (
                <PopoverToggleRow
                  detail={profile.command}
                  enabled={selection.enabledLspProfileIds.includes(profile.id)}
                  key={profile.id}
                  label={profile.name}
                  onToggle={() =>
                    onToggle({
                      ...selection,
                      enabledLspProfileIds: toggleInArray(selection.enabledLspProfileIds, profile.id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── InlineApprovalPill ────────────────────────────────────── */

const approvalKindOrder: ApprovalToolKind[] = ['builtin', 'mcp', 'lsp', 'mixed'];
const approvalKindLabels: Record<ApprovalToolKind, string> = {
  builtin: 'Built-in',
  mcp: 'MCP Servers',
  lsp: 'Language Servers',
  mixed: 'Other',
};

export function InlineApprovalPill({
  approvalTools,
  effectiveAutoApproved,
  isOverridden,
  disabled,
  onUpdate,
}: {
  approvalTools: ApprovalToolDefinition[];
  effectiveAutoApproved: Set<string>;
  isOverridden: boolean;
  disabled: boolean;
  onUpdate: (settings: { autoApprovedToolNames?: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  function toggleTool(toolId: string) {
    const next = new Set(effectiveAutoApproved);
    if (next.has(toolId)) {
      next.delete(toolId);
    } else {
      next.add(toolId);
    }
    onUpdate({ autoApprovedToolNames: [...next] });
  }

  const groups = approvalKindOrder
    .map((kind) => ({ kind, tools: approvalTools.filter((t) => t.kind === kind) }))
    .filter((g) => g.tools.length > 0);
  const showHeaders = groups.length > 1;

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] leading-none font-medium transition ${
          open
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
            : isOverridden
              ? 'border-amber-500/30 bg-amber-500/5 text-amber-400 hover:border-amber-500/50'
              : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <ShieldCheck className="size-2.5" />
        <span>{effectiveAutoApproved.size}/{approvalTools.length} auto-approved</span>
        <ChevronDown className={`size-2.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-80 w-72 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
              isOverridden
                ? 'bg-amber-500/15 text-amber-400'
                : 'bg-zinc-800 text-zinc-500'
            }`}>
              {isOverridden ? 'Session override' : 'Pattern defaults'}
            </span>
            {isOverridden && (
              <button
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                onClick={() => onUpdate({})}
                type="button"
              >
                <RotateCcw className="size-2.5" />
                Reset
              </button>
            )}
          </div>

          <div className="py-1">
            {groups.map((group, i) => (
              <div key={group.kind}>
                {showHeaders && (
                  <div className={`px-3 pb-1 ${i > 0 ? 'pt-2' : 'pt-1'} text-[9px] font-semibold uppercase tracking-wider text-zinc-600`}>
                    {approvalKindLabels[group.kind]}
                  </div>
                )}
                {group.tools.map((tool) => {
                  const detail = tool.description || (tool.providerNames.length > 0 ? tool.providerNames.join(', ') : undefined);
                  return (
                    <PopoverToggleRow
                      detail={detail}
                      enabled={effectiveAutoApproved.has(tool.id)}
                      key={tool.id}
                      label={tool.label}
                      onToggle={() => toggleTool(tool.id)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
