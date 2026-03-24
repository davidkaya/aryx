import { useMemo, type ReactNode } from 'react';
import { Activity, Clock, Server, Code, ShieldAlert, Sparkles, Users } from 'lucide-react';

import {
  buildAgentActivityRows,
  formatAgentActivityLabel,
  isAgentActivityActive,
  isAgentActivityCompleted,
  type AgentActivityRow,
  type SessionActivityState,
} from '@renderer/lib/sessionActivity';
import { RunTimeline } from '@renderer/components/RunTimeline';
import { inferProvider } from '@shared/domain/models';
import type { OrchestrationMode, PatternAgentDefinition, PatternDefinition } from '@shared/domain/pattern';
import {
  resolveSessionToolingSelection,
  type SessionRecord,
} from '@shared/domain/session';
import type {
  LspProfileDefinition,
  McpServerDefinition,
  SessionToolingSelection,
} from '@shared/domain/tooling';
import { ProviderIcon } from './ProviderIcons';

/* ── Mode accent colours ───────────────────────────────────── */

const modeAccent: Record<OrchestrationMode, { dot: string; bar: string; label: string }> = {
  single:       { dot: 'bg-indigo-400',  bar: 'bg-indigo-500/60',  label: 'text-indigo-400' },
  sequential:   { dot: 'bg-amber-400',   bar: 'bg-amber-500/60',   label: 'text-amber-400' },
  concurrent:   { dot: 'bg-emerald-400', bar: 'bg-emerald-500/60', label: 'text-emerald-400' },
  handoff:      { dot: 'bg-sky-400',     bar: 'bg-sky-500/60',     label: 'text-sky-400' },
  'group-chat': { dot: 'bg-violet-400',  bar: 'bg-violet-500/60',  label: 'text-violet-400' },
  magentic:     { dot: 'bg-zinc-500',    bar: 'bg-zinc-600/60',    label: 'text-zinc-500' },
};

/* ── Helpers ───────────────────────────────────────────────── */

function formatModel(model: string): string {
  return model.replace(/-/g, '\u2011');
}

function formatEffort(effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  const labels: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Max',
  };
  return labels[effort] ?? effort;
}

const modeLabels: Record<OrchestrationMode, string> = {
  single: 'Single agent',
  sequential: 'Sequential',
  concurrent: 'Concurrent',
  handoff: 'Handoff',
  'group-chat': 'Group chat',
  magentic: 'Magentic',
};

/* ── Section header ────────────────────────────────────────── */

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
      {children}
    </h3>
  );
}

/* ── Agent row ─────────────────────────────────────────────── */

function AgentRow({
  row,
  agent,
  accent,
  isLast,
}: {
  row: AgentActivityRow;
  agent?: PatternAgentDefinition;
  accent: (typeof modeAccent)[OrchestrationMode];
  isLast: boolean;
}) {
  const isActive = isAgentActivityActive(row.activity);
  const isCompleted = isAgentActivityCompleted(row.activity);

  return (
    <div className={`relative flex gap-2.5 py-2.5 ${isLast ? '' : 'border-b border-zinc-800/50'}`}>
      {/* Left accent bar — visible only when this agent is actively working */}
      {isActive && (
        <div className={`absolute -left-3 bottom-2 top-2 w-[3px] rounded-full ${accent.bar}`} />
      )}

      {/* Status dot */}
      <div className="flex shrink-0 pt-0.5">
        <span
          className={`size-2 rounded-full ${
            isActive
              ? `animate-pulse ${accent.dot}`
              : isCompleted
                ? 'bg-emerald-400'
                : 'bg-zinc-700'
          }`}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-zinc-200">{row.agentName}</span>
        </div>

        {/* Model + effort inline */}
        {agent && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
              {(() => {
                const prov = inferProvider(agent.model);
                return prov ? <ProviderIcon provider={prov} className="size-2.5" /> : null;
              })()}
              {formatModel(agent.model)}
            </span>
            {agent.reasoningEffort && (
              <>
                <span className="text-[10px] text-zinc-700">·</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
                  <Sparkles className="size-2" />
                  {formatEffort(agent.reasoningEffort)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Activity label */}
        <div className="mt-1 flex items-center gap-1">
          <span
            className={`text-[10px] ${
              isActive
                ? accent.label
                : isCompleted
                  ? 'text-emerald-400'
                  : 'text-zinc-600'
            }`}
          >
            {formatAgentActivityLabel(row.activity)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── ActivityPanel ─────────────────────────────────────────── */

interface ActivityPanelProps {
  activity?: SessionActivityState;
  lspProfiles: LspProfileDefinition[];
  mcpServers: McpServerDefinition[];
  onJumpToMessage?: (messageId: string) => void;
  onUpdateSessionTooling: (selection: SessionToolingSelection) => void;
  pattern: PatternDefinition;
  projectIsScratchpad: boolean;
  session: SessionRecord;
}

export function ActivityPanel({
  activity,
  lspProfiles,
  mcpServers,
  onJumpToMessage,
  onUpdateSessionTooling,
  pattern,
  projectIsScratchpad,
  session,
}: ActivityPanelProps) {
  const activityRows = useMemo(
    () => buildAgentActivityRows(activity, pattern.agents),
    [activity, pattern.agents],
  );
  const selection = useMemo(() => resolveSessionToolingSelection(session), [session]);

  const isBusy = session.status === 'running';
  const hasPendingApproval = session.pendingApproval?.status === 'pending';
  const toolsDisabled = isBusy || projectIsScratchpad;
  const accent = modeAccent[pattern.mode] ?? modeAccent.single;
  const hasTools = mcpServers.length > 0 || lspProfiles.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header — top padding clears the title bar overlay zone */}
      <div className="drag-region border-b border-[var(--color-border)] px-4 pb-3 pt-3">
        <div className="flex min-h-8 items-center gap-2">
          <Activity className="size-4 text-zinc-500" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Activity
          </span>
          {hasPendingApproval ? (
            <span className="flex items-center gap-1">
              <ShieldAlert className="size-3 text-amber-400" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-400">Approval</span>
            </span>
          ) : isBusy ? (
            <span className="size-1.5 animate-pulse rounded-full bg-blue-400" />
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* ── Agents section ───────────────────────────────── */}
        <div className="mb-4">
          <SectionHeader>
            <Users className="size-3" />
            <span>Agents</span>
            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-500">
              {activityRows.length}
            </span>
            <span className={`ml-auto text-[9px] font-medium normal-case tracking-normal ${accent.label}`}>
              {modeLabels[pattern.mode]}
            </span>
          </SectionHeader>

          {activityRows.length > 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3">
              {activityRows.map((row, index) => (
                <AgentRow
                  accent={accent}
                  agent={pattern.agents[index]}
                  isLast={index === activityRows.length - 1}
                  key={row.key}
                  row={row}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-[11px] text-zinc-600">No agents configured</p>
          )}
        </div>

        {/* ── Run timeline section ─────────────────────────── */}
        <div className="mb-4">
          <SectionHeader>
            <Clock className="size-3" />
            <span>Timeline</span>
            {session.runs.length > 0 && (
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-500">
                {session.runs.length}
              </span>
            )}
          </SectionHeader>

          <RunTimeline onJumpToMessage={onJumpToMessage} runs={session.runs} />
        </div>

        {/* ── Tools section ────────────────────────────────── */}
        <div>
          <SectionHeader>
            <Server className="size-3" />
            <span>Tools</span>
            {toolsDisabled && (
              <span className="ml-auto text-[9px] font-medium normal-case tracking-normal text-zinc-600">
                {projectIsScratchpad ? 'Scratchpad' : 'Running'}
              </span>
            )}
          </SectionHeader>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
            {projectIsScratchpad ? (
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Start a project-backed session to use MCPs or LSPs.
              </p>
            ) : !hasTools ? (
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Add MCP servers or LSP profiles in Settings to enable them here.
              </p>
            ) : (
              <div className="space-y-0.5">
                {mcpServers.map((server) => (
                  <ToolToggleRow
                    detail={server.transport === 'local' ? server.command : server.url}
                    disabled={toolsDisabled}
                    enabled={selection.enabledMcpServerIds.includes(server.id)}
                    icon={<Server className="size-3 text-zinc-600" />}
                    key={server.id}
                    label={server.name}
                    onToggle={() =>
                      onUpdateSessionTooling({
                        ...selection,
                        enabledMcpServerIds: toggleId(selection.enabledMcpServerIds, server.id),
                      })
                    }
                  />
                ))}
                {lspProfiles.map((profile) => (
                  <ToolToggleRow
                    detail={profile.command}
                    disabled={toolsDisabled}
                    enabled={selection.enabledLspProfileIds.includes(profile.id)}
                    icon={<Code className="size-3 text-zinc-600" />}
                    key={profile.id}
                    label={profile.name}
                    onToggle={() =>
                      onUpdateSessionTooling({
                        ...selection,
                        enabledLspProfileIds: toggleId(selection.enabledLspProfileIds, profile.id),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolToggleRow({
  label,
  detail,
  icon,
  enabled,
  disabled,
  onToggle,
}: {
  label: string;
  detail?: string;
  icon: ReactNode;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-zinc-800/60'
      }`}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-zinc-300">{label}</div>
        {detail && (
          <div className="truncate text-[10px] text-zinc-600">{detail}</div>
        )}
      </div>
      <ToggleSwitch enabled={enabled} />
    </button>
  );
}

function ToggleSwitch({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`relative inline-flex h-[16px] w-[28px] shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-indigo-500' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`inline-block size-[12px] rounded-full bg-white shadow-sm transition-transform ${
          enabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
        }`}
      />
    </span>
  );
}

function toggleId(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((currentId) => currentId !== id)
    : [...current, id];
}
