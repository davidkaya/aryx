import { useMemo, type ReactNode } from 'react';
import { Activity, Bot, Server, Code, Sparkles } from 'lucide-react';

import {
  buildAgentActivityRows,
  formatAgentActivityLabel,
  isAgentActivityActive,
  isAgentActivityCompleted,
  type SessionActivityState,
} from '@renderer/lib/sessionActivity';
import { inferProvider } from '@shared/domain/models';
import type { PatternDefinition } from '@shared/domain/pattern';
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

function formatModel(model: string): string {
  return model.replace(/-/g, '\u2011');
}

function formatEffort(effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  const labels: Record<string, string> = {
    low: 'Low effort',
    medium: 'Medium effort',
    high: 'High effort',
    xhigh: 'Max effort',
  };
  return labels[effort] ?? effort;
}

interface ActivityPanelProps {
  activity?: SessionActivityState;
  lspProfiles: LspProfileDefinition[];
  mcpServers: McpServerDefinition[];
  onUpdateSessionTooling: (selection: SessionToolingSelection) => void;
  pattern: PatternDefinition;
  projectIsScratchpad: boolean;
  session: SessionRecord;
}

export function ActivityPanel({
  activity,
  lspProfiles,
  mcpServers,
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
  const toolsDisabled = isBusy || projectIsScratchpad;

  return (
    <div className="flex h-full flex-col">
      {/* Header — top padding clears the title bar overlay zone */}
      <div className="border-b border-[var(--color-border)] px-4 pb-3 pt-12">
        <div className="flex min-h-8 items-center gap-2">
          <Activity className="size-4 text-zinc-500" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Activity
          </span>
          {isBusy && <span className="size-1.5 animate-pulse rounded-full bg-blue-400" />}
        </div>
      </div>

      {/* Agent cards */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Session tools
              </h3>
              {toolsDisabled && (
                <span className="text-[10px] text-zinc-600">
                  {projectIsScratchpad ? 'Scratchpad' : 'Running'}
                </span>
              )}
            </div>

            {projectIsScratchpad ? (
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                Start a project-backed session to use MCPs or LSPs.
              </p>
            ) : mcpServers.length === 0 && lspProfiles.length === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                Add MCP servers or LSP profiles in Settings to enable them here.
              </p>
            ) : (
              <div className="mt-2 space-y-0.5">
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

          {activityRows.map((row, index) => {
            const agent = pattern.agents[index];
            const isActive = isAgentActivityActive(row.activity);
            const isCompleted = isAgentActivityCompleted(row.activity);

            return (
              <div
                className={`rounded-lg border px-3 py-2.5 transition-colors ${
                  isActive
                    ? 'border-blue-500/20 bg-blue-500/5'
                    : isCompleted
                      ? 'border-emerald-500/15 bg-emerald-500/5'
                      : 'border-zinc-800 bg-zinc-900/40'
                }`}
                key={row.key}
              >
                {/* Agent name + status dot */}
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      isActive
                        ? 'animate-pulse bg-blue-400'
                        : isCompleted
                          ? 'bg-emerald-400'
                          : 'bg-zinc-700'
                    }`}
                  />
                  <span className="truncate text-[12px] font-semibold text-zinc-200">
                    {row.agentName}
                  </span>
                </div>

                {/* Model + reasoning effort badges */}
                {agent && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                      {(() => {
                        const prov = inferProvider(agent.model);
                        if (prov) {
                          return <ProviderIcon provider={prov} className="size-3" />;
                        }
                        return null;
                      })()}
                      {formatModel(agent.model)}
                    </span>
                    {agent.reasoningEffort && (
                      <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                        <Sparkles className="size-2.5" />
                        {formatEffort(agent.reasoningEffort)}
                      </span>
                    )}
                  </div>
                )}

                {/* Description */}
                {agent?.description && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                    {agent.description}
                  </p>
                )}

                {/* Activity status */}
                <div className="mt-2 flex items-center gap-1.5">
                  <Bot className="size-3 text-zinc-600" />
                  <span
                    className={`text-[11px] ${
                      isActive
                        ? 'text-blue-400'
                        : isCompleted
                          ? 'text-emerald-400'
                          : 'text-zinc-600'
                    }`}
                  >
                    {formatAgentActivityLabel(row.activity)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {activityRows.length === 0 && (
          <p className="py-6 text-center text-[12px] text-zinc-600">
            No agents configured
          </p>
        )}
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
