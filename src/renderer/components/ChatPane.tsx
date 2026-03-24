import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Bot, Check, ChevronDown, Circle, GitBranch, Loader2, RotateCcw, Server, ShieldAlert, ShieldCheck, Sparkles, User, X } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import { getAssistantMessagePhase } from '@renderer/lib/messagePhase';
import { ProviderIcon } from '@renderer/components/ProviderIcons';
import type { ApprovalDecision, PendingApprovalRecord } from '@shared/domain/approval';
import {
  findModel,
  getSupportedReasoningEfforts,
  inferProvider,
  providerMeta,
  resolveReasoningEffort,
  type ModelDefinition,
} from '@shared/domain/models';
import { reasoningEffortOptions, type PatternDefinition, type ReasoningEffort } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import { resolveSessionToolingSelection, type SessionRecord } from '@shared/domain/session';
import {
  listApprovalToolDefinitions,
  type ApprovalToolDefinition,
  type ApprovalToolKind,
  type LspProfileDefinition,
  type McpServerDefinition,
  type RuntimeToolDefinition,
  type SessionToolingSelection,
  type WorkspaceToolingSettings,
} from '@shared/domain/tooling';

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="thinking-dot size-2 rounded-full bg-zinc-500" />
      <span className="thinking-dot size-2 rounded-full bg-zinc-500" />
      <span className="thinking-dot size-2 rounded-full bg-zinc-500" />
    </div>
  );
}

/* ── Tier badge for model dropdown ─────────────────────────── */

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

/* ── Inline model pill with dropdown ───────────────────────── */

function InlineModelPill({
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

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
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition ${
          open
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
            : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {provider && <ProviderIcon provider={provider} className="size-3" />}
        <span className="max-w-[140px] truncate">{displayName}</span>
        <ChevronDown className={`size-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-72 w-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
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

/* ── Inline thinking effort pill with dropdown ─────────────── */

function InlineThinkingPill({
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const options = supportedEfforts
    ? reasoningEffortOptions.filter((o) => supportedEfforts.includes(o.value))
    : [...reasoningEffortOptions];

  if (supportedEfforts && supportedEfforts.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800/40 bg-zinc-800/20 px-2 py-1 text-[12px] text-zinc-600">
        <Sparkles className="size-3" />
        N/A
      </span>
    );
  }

  const currentLabel = options.find((o) => o.value === value)?.label ?? value ?? 'Thinking';

  return (
    <div className="relative" ref={ref}>
      <button
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition ${
          open
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
            : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Sparkles className="size-3" />
        <span>{currentLabel}</span>
        <ChevronDown className={`size-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 w-36 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
          {options.map((option) => (
            <button
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-zinc-800 ${
                option.value === value ? 'bg-indigo-500/10 text-indigo-200' : 'text-zinc-300'
              }`}
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
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

/* ── Inline tools pill with popover ─────────────────────────── */

function InlineToolsPill({
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const enabledCount = selection.enabledMcpServerIds.length + selection.enabledLspProfileIds.length;
  const totalCount = mcpServers.length + lspProfiles.length;

  return (
    <div className="relative" ref={ref}>
      <button
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition ${
          open
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
            : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Server className="size-3" />
        <span>{enabledCount}/{totalCount} tools</span>
        <ChevronDown className={`size-3 transition ${open ? 'rotate-180' : ''}`} />
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

/* ── Inline auto-approval pill with popover ────────────────── */

const approvalKindOrder: ApprovalToolKind[] = ['builtin', 'mcp', 'lsp', 'mixed'];
const approvalKindLabels: Record<ApprovalToolKind, string> = {
  builtin: 'Built-in',
  mcp: 'MCP Servers',
  lsp: 'Language Servers',
  mixed: 'Other',
};

function InlineApprovalPill({
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

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
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition ${
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
        <ShieldCheck className="size-3" />
        <span>{effectiveAutoApproved.size}/{approvalTools.length} auto-approved</span>
        <ChevronDown className={`size-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-80 w-72 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
          {/* Override state + reset */}
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

          {/* Tool list grouped by kind */}
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

/* ── Shared popover toggle row + helpers ───────────────────── */

function PopoverToggleRow({
  label,
  detail,
  enabled,
  onToggle,
}: {
  label: string;
  detail?: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-zinc-800"
      onClick={onToggle}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-zinc-300">{label}</div>
        {detail && <div className="truncate text-[10px] text-zinc-600">{detail}</div>}
      </div>
      <span
        className={`relative inline-flex h-[14px] w-[24px] shrink-0 items-center rounded-full transition-colors ${
          enabled ? 'bg-indigo-500' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`inline-block size-[10px] rounded-full bg-white shadow-sm transition-transform ${
            enabled ? 'translate-x-[12px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
    </button>
  );
}

function toggleInArray(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((currentId) => currentId !== id)
    : [...current, id];
}

/* ── Approval banner ────────────────────────────────────────── */

function ApprovalBanner({
  approval,
  onResolve,
  isResolving,
  position,
  total,
}: {
  approval: PendingApprovalRecord;
  onResolve: (decision: ApprovalDecision) => void;
  isResolving: boolean;
  position?: number;
  total?: number;
}) {
  const kindLabel = approval.kind === 'final-response' ? 'Final response review' : 'Tool call approval';
  const hasMessages = approval.messages && approval.messages.length > 0;
  const showPosition = position !== undefined && total !== undefined && total > 1;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-amber-200">{approval.title}</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
              {kindLabel}
            </span>
            {showPosition && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] font-semibold tabular-nums text-zinc-400">
                {position} of {total}
              </span>
            )}
          </div>

          {/* Agent / permission context */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            {approval.agentName && <span>Agent: <span className="text-zinc-300">{approval.agentName}</span></span>}
            {approval.toolName && <span>Tool: <span className="text-zinc-300">{approval.toolName}</span></span>}
            {approval.permissionKind && <span>Permission: <span className="text-zinc-300">{approval.permissionKind}</span></span>}
          </div>

          {approval.detail && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{approval.detail}</p>
          )}
        </div>
      </div>

      {/* Final-response message preview */}
      {hasMessages && (
        <div className="mt-3 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Pending messages — not yet published
          </p>
          {approval.messages!.map((message) => (
            <div className="mt-2" key={message.id}>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-zinc-500">
                <Bot className="size-3" />
                <span>{message.authorName}</span>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-[13px] leading-relaxed text-zinc-300">
                <MarkdownContent content={message.content} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isResolving}
          onClick={() => onResolve('approved')}
          type="button"
        >
          {isResolving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Approve
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3.5 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isResolving}
          onClick={() => onResolve('rejected')}
          type="button"
        >
          <X className="size-3" />
          Reject
        </button>
        {showPosition && (
          <span className="ml-auto text-[10px] text-zinc-600">
            Next approval will appear after this one is resolved
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Queued approvals preview ──────────────────────────────── */

function QueuedApprovalsList({ approvals }: { approvals: PendingApprovalRecord[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <ShieldCheck className="size-3 text-zinc-500" />
        <span className="text-[11px] font-medium text-zinc-400">
          {approvals.length} queued approval{approvals.length === 1 ? '' : 's'}
        </span>
        <ChevronDown
          className={`ml-auto size-3 text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-800/60 pt-2">
          {approvals.map((approval) => {
            const kindLabel = approval.kind === 'final-response' ? 'response' : 'tool';
            return (
              <div
                className="flex items-center gap-2 rounded-md bg-zinc-800/40 px-2.5 py-1.5"
                key={approval.id}
              >
                <ShieldAlert className="size-3 shrink-0 text-zinc-600" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">{approval.title}</span>
                <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-zinc-500">
                  {kindLabel}
                </span>
                {approval.toolName && (
                  <span className="shrink-0 text-[10px] text-zinc-500">{approval.toolName}</span>
                )}
                {approval.agentName && (
                  <span className="shrink-0 text-[10px] text-zinc-600">{approval.agentName}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── ChatPane ──────────────────────────────────────────────── */

interface ChatPaneProps {
  project: ProjectRecord;
  pattern: PatternDefinition;
  session: SessionRecord;
  availableModels: ReadonlyArray<ModelDefinition>;
  toolingSettings: WorkspaceToolingSettings;
  runtimeTools?: ReadonlyArray<RuntimeToolDefinition>;
  onSend: (content: string) => Promise<void>;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => Promise<unknown>;
  onUpdateScratchpadConfig?: (config: {
    model: string;
    reasoningEffort?: ReasoningEffort;
  }) => Promise<unknown>;
  onUpdateSessionTooling?: (selection: SessionToolingSelection) => void;
  onUpdateSessionApprovalSettings?: (settings: { autoApprovedToolNames?: string[] }) => void;
}

export function ChatPane({
  project,
  pattern,
  session,
  availableModels,
  toolingSettings,
  runtimeTools,
  onSend,
  onResolveApproval,
  onUpdateScratchpadConfig,
  onUpdateSessionTooling,
  onUpdateSessionApprovalSettings,
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const [configError, setConfigError] = useState<string>();
  const [approvalError, setApprovalError] = useState<string>();
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const [isUpdatingScratchpadConfig, setIsUpdatingScratchpadConfig] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isSessionBusy = session.status === 'running';
  const pendingApproval = session.pendingApproval?.status === 'pending' ? session.pendingApproval : undefined;
  const queuedApprovals = (session.pendingApprovalQueue ?? []).filter((a) => a.status === 'pending');
  const totalPendingCount = (pendingApproval ? 1 : 0) + queuedApprovals.length;
  const isScratchpad = isScratchpadProject(project);
  const primaryAgent = pattern.agents[0];
  const selectedModel = primaryAgent ? findModel(primaryAgent.model, availableModels) : undefined;
  const supportedEfforts = getSupportedReasoningEfforts(selectedModel);
  const scratchpadReasoningEffort = resolveReasoningEffort(selectedModel, primaryAgent?.reasoningEffort);
  const isComposerDisabled = isSessionBusy || isUpdatingScratchpadConfig;

  const toolSelection = useMemo(() => resolveSessionToolingSelection(session), [session]);
  const mcpServers = toolingSettings.mcpServers;
  const lspProfiles = toolingSettings.lspProfiles;
  const hasConfigurableTools = mcpServers.length > 0 || lspProfiles.length > 0;
  const hasToolCallApproval = pattern.approvalPolicy?.rules.some((r) => r.kind === 'tool-call') ?? false;
  const approvalTools = useMemo(
    () => listApprovalToolDefinitions(toolingSettings, runtimeTools),
    [runtimeTools, toolingSettings],
  );
  const isApprovalOverridden = session.approvalSettings !== undefined;
  const effectiveAutoApproved = useMemo(
    () => new Set(
      isApprovalOverridden
        ? session.approvalSettings!.autoApprovedToolNames
        : pattern.approvalPolicy?.autoApprovedToolNames ?? [],
    ),
    [isApprovalOverridden, session.approvalSettings, pattern.approvalPolicy],
  );

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [session.messages.length, isSessionBusy]);

  useEffect(() => {
    setConfigError(undefined);
    setApprovalError(undefined);
    setIsResolvingApproval(false);
    setIsUpdatingScratchpadConfig(false);
  }, [session.id]);

  async function handleSubmit() {
    const text = input.trim();
    if (!text || isComposerDisabled) return;
    setInput('');
    await onSend(text);
  }

  async function handleScratchpadConfigChange(config: {
    model: string;
    reasoningEffort?: ReasoningEffort;
  }) {
    if (!isScratchpad || !primaryAgent || isComposerDisabled || !onUpdateScratchpadConfig) {
      return;
    }

    if (
      config.model === primaryAgent.model &&
      config.reasoningEffort === scratchpadReasoningEffort
    ) {
      return;
    }

    setConfigError(undefined);
    setIsUpdatingScratchpadConfig(true);

    try {
      await onUpdateScratchpadConfig(config);
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUpdatingScratchpadConfig(false);
    }
  }

  async function handleResolveApproval(decision: ApprovalDecision) {
    if (!pendingApproval || !onResolveApproval || isResolvingApproval) return;

    setApprovalError(undefined);
    setIsResolvingApproval(true);

    try {
      await onResolveApproval(pendingApproval.id, decision);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsResolvingApproval(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — extra top padding clears the title bar overlay zone */}
      <header className="drag-region border-b border-[var(--color-border)] px-6 pb-3 pt-3">
        <div className="flex min-h-8 items-center justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold leading-tight text-zinc-100">{session.title}</h2>
            <p className="truncate text-[11px] leading-tight text-zinc-500">
              {isScratchpad
                ? `Scratchpad · ${pattern.name}`
                : `${project.name} · ${pattern.name} · ${pattern.mode}`}
              {!isScratchpad && project.git?.status === 'ready' && (
                <span className="ml-2 inline-flex items-center gap-1 text-zinc-600">
                  <GitBranch className="inline size-2.5" />
                  {project.git.branch ?? project.git.head?.shortHash ?? 'HEAD'}
                  {project.git.isDirty && (
                    <Circle className="inline size-1.5 fill-amber-500 text-amber-500" />
                  )}
                  {(project.git.ahead ?? 0) > 0 && <span>↑{project.git.ahead}</span>}
                  {(project.git.behind ?? 0) > 0 && <span>↓{project.git.behind}</span>}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pendingApproval && (
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-400">
                <ShieldAlert className="size-3.5" />
                Awaiting approval
                {queuedApprovals.length > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] tabular-nums">
                    +{queuedApprovals.length} queued
                  </span>
                )}
              </div>
            )}
            {isSessionBusy && !pendingApproval && <span className="size-2 animate-pulse rounded-full bg-blue-400" />}
            {session.status === 'error' && (
              <div className="flex items-center gap-1.5 text-[12px] text-red-400">
                <AlertCircle className="size-3.5" />
                Error
              </div>
            )}
            {session.status === 'idle' && !pendingApproval && session.messages.length > 0 && (
              <span className="text-[12px] text-zinc-600">
                {session.messages.length} message{session.messages.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={transcriptRef}>
        {session.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Bot className="size-10 text-zinc-800" />
            <p className="text-[13px] text-zinc-500">Send a message to start the conversation</p>
            <p className="text-[12px] text-zinc-700">
              {isScratchpad ? (
                <>
                  Scratchpad is ready for ad-hoc questions using{' '}
                  <span className="text-zinc-500">{pattern.name}</span>
                </>
              ) : (
                <>
                  Using <span className="text-zinc-500">{pattern.name}</span> in{' '}
                  <span className="text-zinc-500">{project.name}</span>
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-4">
            <div className="space-y-1">
              {session.messages.map((message, index) => {
                const isUser = message.role === 'user';
                const phase = getAssistantMessagePhase(session, message, index);
                const assistantContainerClass =
                  phase === 'thinking'
                    ? 'border-sky-500/20 bg-sky-500/5'
                    : phase === 'final'
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-zinc-800 bg-zinc-900/40';
                const assistantBadgeClass =
                  phase === 'thinking'
                    ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
                    : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
                const phaseLabel =
                  phase === 'thinking' ? 'Thinking' : phase === 'final' ? 'Final' : undefined;

                return (
                  <div className="group py-3" data-message-id={message.id} key={message.id}>
                    <div className="flex gap-3">
                      <div
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                          isUser ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-zinc-400">
                          <span>{message.authorName}</span>
                          {!isUser && phaseLabel && (
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${assistantBadgeClass}`}
                            >
                              {phaseLabel}
                            </span>
                          )}
                        </div>
                        <div
                          className={
                            isUser
                              ? 'text-[14px] leading-relaxed text-zinc-200'
                              : `rounded-xl border px-4 py-3 text-[14px] leading-relaxed text-zinc-200 ${assistantContainerClass}`
                          }
                        >
                          {!isUser && message.pending ? (
                            <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-zinc-200">
                              {message.content}
                            </div>
                          ) : (
                            <MarkdownContent content={message.content} />
                          )}
                          {message.pending && message.content && (
                            <span className="mt-1 inline-block h-4 w-[2px] animate-pulse rounded-sm bg-zinc-400" />
                          )}
                        </div>
                        {message.pending && !message.content && <ThinkingDots />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--color-border)] px-6 py-4">
        {session.lastError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <span>{session.lastError}</span>
          </div>
        )}

        {configError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <span>{configError}</span>
          </div>
        )}

        {approvalError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <span>{approvalError}</span>
          </div>
        )}

        <div className="mx-auto max-w-3xl">
          {/* Pending approval banner */}
          {pendingApproval && (
            <div className="mb-3 space-y-2">
              <ApprovalBanner
                approval={pendingApproval}
                isResolving={isResolvingApproval}
                onResolve={(decision) => void handleResolveApproval(decision)}
                position={totalPendingCount > 1 ? 1 : undefined}
                total={totalPendingCount > 1 ? totalPendingCount : undefined}
              />
              {queuedApprovals.length > 0 && (
                <QueuedApprovalsList approvals={queuedApprovals} />
              )}
            </div>
          )}

          {/* Scratchpad config pills — inline above composer */}
          {isScratchpad && primaryAgent && (
            <div className="mb-2 flex items-center gap-2">
              <InlineModelPill
                disabled={isComposerDisabled}
                models={availableModels}
                onChange={(modelId) => {
                  const nextModel = findModel(modelId, availableModels);
                  void handleScratchpadConfigChange({
                    model: modelId,
                    reasoningEffort: resolveReasoningEffort(nextModel, scratchpadReasoningEffort),
                  });
                }}
                value={primaryAgent.model}
              />
              <InlineThinkingPill
                disabled={isComposerDisabled}
                onChange={(reasoningEffort) =>
                  void handleScratchpadConfigChange({
                    model: primaryAgent.model,
                    reasoningEffort,
                  })
                }
                supportedEfforts={supportedEfforts}
                value={scratchpadReasoningEffort}
              />
              {isUpdatingScratchpadConfig && (
                <Loader2 className="size-3 animate-spin text-zinc-500" />
              )}
            </div>
          )}

          {/* Session config pills — tool & approval controls */}
          {!isScratchpad && (hasConfigurableTools || hasToolCallApproval) && (
            <div className="mb-2 flex items-center gap-2">
              {hasConfigurableTools && onUpdateSessionTooling && (
                <InlineToolsPill
                  disabled={isComposerDisabled}
                  lspProfiles={lspProfiles}
                  mcpServers={mcpServers}
                  onToggle={onUpdateSessionTooling}
                  selection={toolSelection}
                />
              )}
              {hasToolCallApproval && onUpdateSessionApprovalSettings && approvalTools.length > 0 && (
                <InlineApprovalPill
                  approvalTools={approvalTools}
                  disabled={isComposerDisabled}
                  effectiveAutoApproved={effectiveAutoApproved}
                  isOverridden={isApprovalOverridden}
                  onUpdate={onUpdateSessionApprovalSettings}
                />
              )}
            </div>
          )}

          <div className="relative rounded-xl border border-zinc-700 bg-zinc-900 transition-colors focus-within:border-indigo-500/50">
            <textarea
              className="auto-resize-textarea block w-full resize-none bg-transparent px-4 py-3 pr-12 text-[14px] text-zinc-100 placeholder-zinc-600 outline-none"
              disabled={isComposerDisabled}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                pendingApproval
                  ? 'Awaiting approval...'
                  : isSessionBusy
                    ? 'Waiting for response...'
                    : isUpdatingScratchpadConfig
                      ? 'Saving scratchpad settings...'
                      : 'Message...'
              }
              ref={textareaRef}
              rows={1}
              value={input}
            />
            <button
              className={`absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-lg transition ${
                input.trim() && !isComposerDisabled
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : 'bg-zinc-800 text-zinc-600'
              }`}
              disabled={isComposerDisabled || !input.trim()}
              onClick={() => void handleSubmit()}
              type="button"
            >
              {isSessionBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
