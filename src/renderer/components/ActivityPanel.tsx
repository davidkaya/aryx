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
import type { SessionRecord } from '@shared/domain/session';
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
  pattern: PatternDefinition;
  session: SessionRecord;
}

export function ActivityPanel({ activity, pattern, session }: ActivityPanelProps) {
  const activityRows = useMemo(
    () => buildAgentActivityRows(activity, pattern.agents),
    [activity, pattern.agents],
  );

  const isBusy = session.status === 'running';

  return (
    <div className="flex h-full flex-col">
      {/* Header — top padding clears the title bar overlay zone */}
      <div className="border-b border-[var(--color-border)] px-4 pb-3 pt-12">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-zinc-500" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Activity
          </span>
          {isBusy && <span className="size-1.5 animate-pulse rounded-full bg-blue-400" />}
        </div>
      </div>

      {/* Agent cards */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-2">
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

