import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Minus, Search, Sparkles, TerminalSquare } from 'lucide-react';

import { ProviderIcon } from '@renderer/components/ProviderIcons';
import { PopoverToggleRow } from '@renderer/components/ui';
import { useClickOutside } from '@renderer/hooks/useClickOutside';
import type { ApprovalToolDefinition, LspProfileDefinition, McpServerDefinition, SessionToolingSelection, WorkspaceToolingSettings } from '@shared/domain/tooling';
import { groupApprovalToolsByProvider, type ApprovalToolGroup } from '@shared/domain/tooling';
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
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition ${
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
        <div className="absolute bottom-full right-0 z-40 mb-1.5 max-h-72 w-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl" role="listbox">
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
      <span className="inline-flex items-center gap-1 rounded border border-zinc-800/40 bg-zinc-800/20 px-1.5 py-0.5 text-pill text-zinc-600">
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
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition ${
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
        <div className="absolute bottom-full right-0 z-40 mb-1.5 w-36 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl" role="listbox">
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

  const workspaceMcpServers = mcpServers.filter((s) => !s.id.startsWith('discovered_'));
  const discoveredUserMcpServers = mcpServers.filter((s) => s.id.startsWith('discovered_user_'));
  const discoveredProjectMcpServers = mcpServers.filter((s) => s.id.startsWith('discovered_project_'));

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition ${
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
          {workspaceMcpServers.length > 0 && (
            <McpServerGroup
              label="Workspace MCP"
              onToggle={onToggle}
              selection={selection}
              servers={workspaceMcpServers}
            />
          )}
          {discoveredUserMcpServers.length > 0 && (
            <McpServerGroup
              label="User MCP"
              onToggle={onToggle}
              selection={selection}
              servers={discoveredUserMcpServers}
            />
          )}
          {discoveredProjectMcpServers.length > 0 && (
            <McpServerGroup
              label="Project MCP"
              onToggle={onToggle}
              selection={selection}
              servers={discoveredProjectMcpServers}
            />
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

function McpServerGroup({
  label,
  servers,
  selection,
  onToggle,
}: {
  label: string;
  servers: ReadonlyArray<McpServerDefinition>;
  selection: SessionToolingSelection;
  onToggle: (selection: SessionToolingSelection) => void;
}) {
  return (
    <div>
      <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      {servers.map((server) => (
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
  );
}

/* ── InlineApprovalPill ────────────────────────────────────── */

const SEARCH_THRESHOLD = 10;

export function InlineApprovalPill({
  approvalTools,
  toolingSettings,
  effectiveAutoApproved,
  effectiveAutoApprovedCount,
  isOverridden,
  disabled,
  mcpProbingServerIds,
  onUpdate,
}: {
  approvalTools: ApprovalToolDefinition[];
  toolingSettings: WorkspaceToolingSettings;
  effectiveAutoApproved: Set<string>;
  effectiveAutoApprovedCount: number;
  isOverridden: boolean;
  disabled: boolean;
  mcpProbingServerIds?: string[];
  onUpdate: (settings: { autoApprovedToolNames?: string[] }) => void;
}){
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const ref = useClickOutside<HTMLDivElement>(() => { setOpen(false); setSearch(''); }, open);

  const probingSet = useMemo(
    () => new Set(mcpProbingServerIds ?? []),
    [mcpProbingServerIds],
  );
  const isProbingAny = probingSet.size > 0;

  const groups = useMemo(
    () => groupApprovalToolsByProvider(approvalTools, toolingSettings),
    [approvalTools, toolingSettings],
  );

  const totalItemCount = groups.reduce(
    (sum, g) => sum + Math.max(g.tools.length, g.serverApprovalKey ? 1 : 0),
    0,
  );
  const showSearch = totalItemCount > SEARCH_THRESHOLD;
  const searchLower = search.toLowerCase().trim();

  const filteredGroups = useMemo(() => {
    if (!searchLower) return groups;
    return groups
      .map((group) => ({
        ...group,
        tools: group.tools.filter(
          (t) =>
            t.label.toLowerCase().includes(searchLower)
            || t.id.toLowerCase().includes(searchLower)
            || group.label.toLowerCase().includes(searchLower),
        ),
      }))
      .filter((g) => g.tools.length > 0 || g.label.toLowerCase().includes(searchLower));
  }, [groups, searchLower]);

  function toggleTool(toolId: string) {
    const next = new Set(effectiveAutoApproved);
    if (next.has(toolId)) {
      next.delete(toolId);
    } else {
      next.add(toolId);
    }
    onUpdate({ autoApprovedToolNames: [...next] });
  }

  function toggleGroup(group: ApprovalToolGroup) {
    const next = new Set(effectiveAutoApproved);

    if (group.serverApprovalKey) {
      // MCP servers use server-level approval key
      if (next.has(group.serverApprovalKey)) {
        next.delete(group.serverApprovalKey);
      } else {
        next.add(group.serverApprovalKey);
      }
      // Also remove individual tool entries when toggling server-level
      for (const tool of group.tools) {
        next.delete(tool.id);
      }
    } else {
      // Non-MCP groups: toggle individual tools
      const allApproved = group.tools.every((t) => next.has(t.id));
      for (const tool of group.tools) {
        if (allApproved) {
          next.delete(tool.id);
        } else {
          next.add(tool.id);
        }
      }
    }

    onUpdate({ autoApprovedToolNames: [...next] });
  }

  function isGroupApproved(group: ApprovalToolGroup): 'all' | 'some' | 'none' {
    if (group.serverApprovalKey && effectiveAutoApproved.has(group.serverApprovalKey)) {
      return 'all';
    }
    if (group.tools.length === 0) return 'none';
    const approvedCount = group.tools.filter((t) => effectiveAutoApproved.has(t.id)).length;
    if (approvedCount === group.tools.length) return 'all';
    if (approvedCount > 0) return 'some';
    return 'none';
  }

  function isGroupProbing(group: ApprovalToolGroup): boolean {
    if (group.kind !== 'mcp') return false;
    const serverId = group.id.replace(/^mcp:/, '');
    return probingSet.has(serverId);
  }

  function toggleExpanded(groupId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  function isGroupExpanded(groupId: string): boolean {
    if (searchLower) return true;
    return expandedGroups.has(groupId);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition ${
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
        {isProbingAny ? (
          <Loader2 className="size-2.5 animate-spin" aria-label="Probing MCP servers" />
        ) : (
          <ShieldCheck className="size-2.5" />
        )}
        <span>
          {effectiveAutoApprovedCount}/{totalItemCount} auto-approved
          {isProbingAny && <span className="text-zinc-500"> · probing…</span>}
        </span>
        <ChevronDown className={`size-2.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-[28rem] w-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
          {/* Header: session override / pattern defaults */}
          <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900">
            <div className="flex items-center gap-2 px-3 py-2">
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

            {/* Search */}
            {showSearch && (
              <div className="border-t border-zinc-800/50 px-3 py-1.5">
                <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-800/30 px-2 py-1">
                  <Search className="size-3 shrink-0 text-zinc-600" />
                  <input
                    autoFocus
                    className="w-full bg-transparent text-[12px] text-zinc-300 placeholder-zinc-600 outline-none"
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter tools…"
                    type="text"
                    value={search}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tool groups */}
          <div className="py-1">
            {filteredGroups.map((group, groupIdx) => {
              const isBuiltin = group.kind === 'builtin';
              const isCollapsible = !isBuiltin;
              const expanded = isBuiltin || isGroupExpanded(group.id);
              const probing = isGroupProbing(group);
              const groupState = isGroupApproved(group);
              const allApproved = groupState === 'all';
              const someApproved = groupState === 'some';
              const approvedLabel = group.serverApprovalKey && allApproved
                ? 'all'
                : `${group.tools.filter((t) => effectiveAutoApproved.has(t.id)).length}/${group.tools.length}`;

              return (
                <div key={group.id}>
                  {/* Group header */}
                  {isBuiltin ? (
                    <div className={`px-3 pb-1 ${groupIdx > 0 ? 'pt-2.5' : 'pt-1'} text-[9px] font-semibold uppercase tracking-wider text-zinc-600`}>
                      {group.label}
                    </div>
                  ) : (
                    <div
                      className={`flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left transition hover:bg-zinc-800/60 ${groupIdx > 0 ? 'mt-0.5' : ''}`}
                      onClick={() => toggleExpanded(group.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(group.id); } }}
                      role="button"
                      tabIndex={0}
                    >
                      {probing ? (
                        <Loader2 className="size-3 shrink-0 animate-spin text-indigo-400" aria-label="Probing server" />
                      ) : group.tools.length > 0 ? (
                        <ChevronRight className={`size-3 shrink-0 text-zinc-600 transition ${expanded ? 'rotate-90' : ''}`} />
                      ) : (
                        <Server className="size-3 shrink-0 text-zinc-600" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-300">{group.label}</span>
                      {probing ? (
                        <span className="shrink-0 rounded-full bg-indigo-500/10 px-1.5 py-px text-[9px] font-medium text-indigo-400">
                          probing…
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-zinc-800/80 px-1.5 py-px text-[9px] font-medium tabular-nums text-zinc-500">
                          {approvedLabel}
                        </span>
                      )}
                      {!probing && (
                        <GroupToggle
                          allApproved={allApproved}
                          someApproved={someApproved}
                          onToggle={(e) => { e.stopPropagation(); toggleGroup(group); }}
                        />
                      )}
                    </div>
                  )}

                  {/* Group tools */}
                  {expanded && group.tools.map((tool) => {
                    const detail = tool.description || (
                      !isBuiltin && tool.providerNames.length > 1
                        ? tool.providerNames.join(', ')
                        : undefined
                    );
                    return (
                      <div key={tool.id} className={isCollapsible ? 'pl-3' : ''}>
                        <PopoverToggleRow
                          detail={detail}
                          enabled={effectiveAutoApproved.has(tool.id)}
                          label={tool.label}
                          onToggle={() => toggleTool(tool.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {filteredGroups.length === 0 && searchLower && (
              <div className="px-3 py-4 text-center text-[12px] text-zinc-600">
                No tools match "{search}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupToggle({
  allApproved,
  someApproved,
  onToggle,
}: {
  allApproved: boolean;
  someApproved: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      aria-pressed={allApproved}
      className={`relative inline-flex h-[16px] w-[28px] shrink-0 items-center rounded-full transition-colors ${
        allApproved ? 'bg-indigo-500' : someApproved ? 'bg-zinc-600' : 'bg-zinc-700'
      }`}
      onClick={onToggle}
      type="button"
    >
      {someApproved ? (
        <Minus className="absolute left-1/2 size-2 -translate-x-1/2 text-zinc-300" strokeWidth={3} />
      ) : (
        <span
          className={`inline-block size-[12px] rounded-full bg-white shadow transition-transform ${
            allApproved ? 'translate-x-[13px]' : 'translate-x-[2px]'
          }`}
        />
      )}
    </button>
  );
}

/* ── InlineTerminalPill ────────────────────────────────────── */

export function InlineTerminalPill({
  disabled,
  isRunning,
  isOpen,
  onToggle,
}: {
  disabled: boolean;
  isRunning: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={isOpen}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition ${
        isOpen
          ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
          : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
      } disabled:cursor-not-allowed disabled:opacity-50`}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      {isRunning && <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />}
      <TerminalSquare className="size-2.5" />
      <span>Terminal</span>
    </button>
  );
}
