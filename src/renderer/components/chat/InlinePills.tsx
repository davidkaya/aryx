import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Loader2, Minus, Search, Sparkles, TerminalSquare } from 'lucide-react';

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
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition-all duration-200 ${
          open
            ? 'border-[var(--color-border-glow)] bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]'
            : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/40 text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]'
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
        <div className="absolute bottom-full right-0 z-40 mb-1.5 max-h-72 w-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] py-1 shadow-2xl" role="listbox">
          {groupedModels.map((pg) => (
            <div key={pg.id}>
              <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                <ProviderIcon provider={pg.id} className="size-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {pg.label}
                </span>
              </div>
              {pg.models.map((model) => (
                <button
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-all duration-200 hover:bg-[var(--color-surface-3)] ${
                    model.id === value ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]' : 'text-[var(--color-text-primary)]'
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
              <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Other
              </div>
              {otherModels.map((model) => (
                <button
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-all duration-200 hover:bg-[var(--color-surface-3)] ${
                    model.id === value ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]' : 'text-[var(--color-text-primary)]'
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
      <span className="inline-flex items-center gap-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/20 px-1.5 py-0.5 text-pill text-[var(--color-text-muted)]">
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
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition-all duration-200 ${
          open
            ? 'border-[var(--color-border-glow)] bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]'
            : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/40 text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]'
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
        <div className="absolute bottom-full right-0 z-40 mb-1.5 w-36 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] py-1 shadow-2xl" role="listbox">
          {options.map((option) => (
            <button
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-all duration-200 hover:bg-[var(--color-surface-3)] ${
                option.value === value ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]' : 'text-[var(--color-text-primary)]'
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
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition-all duration-200 ${
          open
            ? 'border-[var(--color-border-glow)] bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]'
            : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/40 text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]'
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
        <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-[28rem] w-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-2xl">
          {/* Header: enable / disable all */}
          <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
            <div className="flex items-center justify-end px-3 py-1.5">
              <button
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
                onClick={() => {
                  const allEnabled = enabledCount === totalCount;
                  onToggle({
                    enabledMcpServerIds: allEnabled ? [] : mcpServers.map((s) => s.id),
                    enabledLspProfileIds: allEnabled ? [] : lspProfiles.map((p) => p.id),
                  });
                }}
                type="button"
              >
                {enabledCount === totalCount ? 'Disable all' : 'Enable all'}
              </button>
            </div>
          </div>

          <div className="py-1">
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
              <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
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
      <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
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

  function toggleTool(toolId: string, group: ApprovalToolGroup) {
    const next = new Set(effectiveAutoApproved);

    // If the group has server-level approval, expand it to individual tools
    // so the user can selectively disable one tool.
    if (group.serverApprovalKey && next.has(group.serverApprovalKey)) {
      next.delete(group.serverApprovalKey);
      for (const tool of group.tools) {
        if (tool.id !== toolId) {
          next.add(tool.id);
        }
      }
    } else if (next.has(toolId)) {
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

  function isToolEffectivelyApproved(toolId: string, group: ApprovalToolGroup): boolean {
    if (effectiveAutoApproved.has(toolId)) return true;
    if (group.serverApprovalKey && effectiveAutoApproved.has(group.serverApprovalKey)) return true;
    return false;
  }

  const allApprovedGlobal = effectiveAutoApprovedCount === totalItemCount && totalItemCount > 0;

  const approveAll = useCallback(() => {
    const next = new Set<string>();
    for (const group of groups) {
      if (group.serverApprovalKey) {
        next.add(group.serverApprovalKey);
      }
      for (const tool of group.tools) {
        next.add(tool.id);
      }
    }
    onUpdate({ autoApprovedToolNames: [...next] });
  }, [groups, onUpdate]);

  const unapproveAll = useCallback(() => {
    onUpdate({ autoApprovedToolNames: [] });
  }, [onUpdate]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-pill font-medium transition-all duration-200 ${
          open
            ? 'border-[var(--color-border-glow)] bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]'
            : isOverridden
              ? 'border-[var(--color-status-warning)]/30 bg-[var(--color-status-warning)]/5 text-[var(--color-status-warning)] hover:border-[var(--color-status-warning)]/50'
              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/40 text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]'
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
          {isProbingAny && <span className="text-[var(--color-text-muted)]"> · probing…</span>}
        </span>
        <ChevronDown className={`size-2.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-[28rem] w-80 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-2xl">
          {/* Header: session override / pattern defaults */}
          <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                isOverridden
                  ? 'bg-[var(--color-status-warning)]/15 text-[var(--color-status-warning)]'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
              }`}>
                {isOverridden ? 'Session override' : 'Pattern defaults'}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {isOverridden && (
                  <button
                    className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
                    onClick={() => onUpdate({})}
                    type="button"
                  >
                    <RotateCcw className="size-2.5" />
                    Reset
                  </button>
                )}
                <button
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
                  onClick={allApprovedGlobal ? unapproveAll : approveAll}
                  type="button"
                >
                  {allApprovedGlobal ? 'Unapprove all' : 'Approve all'}
                </button>
              </span>
            </div>

            {/* Search */}
            {showSearch && (
              <div className="border-t border-[var(--color-border-subtle)] px-3 py-1.5">
                <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 px-2 py-1">
                  <Search className="size-3 shrink-0 text-[var(--color-text-muted)]" />
                  <input
                    autoFocus
                    className="w-full bg-transparent text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none"
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
                    <div className={`px-3 pb-1 ${groupIdx > 0 ? 'pt-2.5' : 'pt-1'} text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]`}>
                      {group.label}
                    </div>
                  ) : (
                    <div
                      className={`flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left transition-all duration-200 hover:bg-[var(--color-surface-3)]/60 ${groupIdx > 0 ? 'mt-0.5' : ''}`}
                      onClick={() => toggleExpanded(group.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(group.id); } }}
                      role="button"
                      tabIndex={0}
                    >
                      {probing ? (
                        <Loader2 className="size-3 shrink-0 animate-spin text-[var(--color-text-accent)]" aria-label="Probing server" />
                      ) : group.tools.length > 0 ? (
                        <ChevronRight className={`size-3 shrink-0 text-[var(--color-text-muted)] transition ${expanded ? 'rotate-90' : ''}`} />
                      ) : (
                        <Server className="size-3 shrink-0 text-[var(--color-text-muted)]" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-primary)]">{group.label}</span>
                      {probing ? (
                        <span className="shrink-0 rounded-full bg-[var(--color-accent-muted)] px-1.5 py-px text-[9px] font-medium text-[var(--color-text-accent)]">
                          probing…
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-2)]/80 px-1.5 py-px text-[9px] font-medium tabular-nums text-[var(--color-text-muted)]">
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
                          enabled={isToolEffectivelyApproved(tool.id, group)}
                          label={tool.label}
                          onToggle={() => toggleTool(tool.id, group)}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {filteredGroups.length === 0 && searchLower && (
              <div className="px-3 py-4 text-center text-[12px] text-[var(--color-text-muted)]">
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
      className={`relative inline-flex h-[14px] w-[24px] shrink-0 items-center rounded-full transition-all duration-200 ${
        allApproved ? 'brand-gradient-bg shadow-[0_0_8px_rgba(36,92,249,0.3)]' : 'bg-[var(--color-surface-3)]'
      }`}
      onClick={onToggle}
      type="button"
    >
      {someApproved ? (
        <Minus className="absolute left-1/2 size-2 -translate-x-1/2 text-[var(--color-text-primary)]" strokeWidth={3} />
      ) : (
        <span
          className={`inline-block size-[10px] rounded-full bg-white shadow-sm transition-transform ${
            allApproved ? 'translate-x-[12px]' : 'translate-x-[2px]'
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
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all duration-200 ${
        isOpen
          ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)] hover:bg-[var(--color-accent)]/20'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]'
      } disabled:cursor-not-allowed disabled:opacity-50`}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      {isRunning && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-status-success)]" />}
      <TerminalSquare className="size-3" />
      <span>Terminal</span>
    </button>
  );
}

/* ── InlineGitPill ─────────────────────────────────────────── */

export function InlineGitPill({
  isDirty,
  isOpen,
  onToggle,
}: {
  isDirty: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={isOpen}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all duration-200 ${
        isOpen
          ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)] hover:bg-[var(--color-accent)]/20'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]'
      }`}
      onClick={onToggle}
      type="button"
    >
      {isDirty && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-status-warning)]" />}
      <GitBranch className="size-3" />
      <span>Git</span>
    </button>
  );
}
