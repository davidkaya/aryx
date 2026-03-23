import { useMemo } from 'react';
import { Activity, Bot, Sparkles } from 'lucide-react';

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
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[12px] font-semibold text-zinc-200">Session tools</h3>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Enable globally configured MCPs and LSPs for this session.
                </p>
              </div>
              {toolsDisabled && (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                  {projectIsScratchpad ? 'Scratchpad disabled' : 'Locked while running'}
                </span>
              )}
            </div>

            {projectIsScratchpad ? (
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Scratchpad stays tool-free. Start a project-backed session to use MCPs or LSPs.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <ToolToggleGroup
                  description="Globally configured MCP servers"
                  emptyMessage="No MCP servers configured in Settings."
                  enabledIds={selection.enabledMcpServerIds}
                  items={mcpServers.map((server) => ({
                    id: server.id,
                    label: server.name,
                    detail:
                      server.transport === 'local'
                        ? server.command
                        : server.url,
                  }))}
                  onToggle={(id) =>
                    onUpdateSessionTooling({
                      ...selection,
                      enabledMcpServerIds: toggleId(selection.enabledMcpServerIds, id),
                    })
                  }
                  title="MCP servers"
                  disabled={toolsDisabled}
                />
                <ToolToggleGroup
                  description="Globally configured LSP profiles"
                  emptyMessage="No LSP profiles configured in Settings."
                  enabledIds={selection.enabledLspProfileIds}
                  items={lspProfiles.map((profile) => ({
                    id: profile.id,
                    label: profile.name,
                    detail: `${profile.languageId} · ${profile.command}`,
                  }))}
                  onToggle={(id) =>
                    onUpdateSessionTooling({
                      ...selection,
                      enabledLspProfileIds: toggleId(selection.enabledLspProfileIds, id),
                    })
                  }
                  title="LSP profiles"
                  disabled={toolsDisabled}
                />
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

function ToolToggleGroup({
  title,
  description,
  items,
  enabledIds,
  onToggle,
  emptyMessage,
  disabled,
}: {
  title: string;
  description: string;
  items: Array<{ id: string; label: string; detail?: string }>;
  enabledIds: string[];
  onToggle: (id: string) => void;
  emptyMessage: string;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="mb-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
          {title}
        </h4>
        <p className="mt-0.5 text-[11px] text-zinc-600">{description}</p>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{emptyMessage}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const enabled = enabledIds.includes(item.id);
            return (
              <button
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  enabled
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : 'border-zinc-800 bg-zinc-900/30'
                } ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-zinc-700 hover:bg-zinc-900/60'}`}
                disabled={disabled}
                key={item.id}
                onClick={() => onToggle(item.id)}
                type="button"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-zinc-200">{item.label}</div>
                  {item.detail && (
                    <div className="truncate text-[11px] text-zinc-500">{item.detail}</div>
                  )}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    enabled
                      ? 'bg-blue-500/10 text-blue-300'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {enabled ? 'Enabled' : 'Disabled'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function toggleId(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((currentId) => currentId !== id)
    : [...current, id];
}
