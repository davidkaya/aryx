import { Sparkles } from 'lucide-react';

import type { AgentNodeConfig } from '@shared/domain/workflow';
import { inferProvider } from '@shared/domain/models';
import {
  formatAgentActivityLabel,
  formatDuration,
  formatTokenCount,
  isAgentActivityActive,
  isAgentActivityCompleted,
  type AgentActivityRow,
  type AgentUsageAccumulator,
} from '@renderer/lib/sessionActivity';
import { ProviderIcon } from '@renderer/components/ProviderIcons';
import { type ModeAccent, formatEffort, formatModel } from './constants';

interface AgentRowProps {
  row: AgentActivityRow;
  agent?: AgentNodeConfig;
  accent: ModeAccent;
  isLast: boolean;
  agentUsage?: AgentUsageAccumulator;
}

export function AgentRow({ row, agent, accent, isLast, agentUsage }: AgentRowProps) {
  const isActive = isAgentActivityActive(row.activity);
  const isCompleted = isAgentActivityCompleted(row.activity);

  return (
    <div className={`relative flex gap-2.5 py-2.5 ${isLast ? '' : 'border-b border-[var(--color-border-subtle)]'}`}>
      {isActive && (
        <div className={`absolute -left-3 bottom-2 top-2 w-[3px] rounded-full ${accent.bar}`} />
      )}

      {/* Status dot */}
      <div className="flex shrink-0 pt-0.5">
        <span
          className={`size-2 rounded-full transition-all duration-200 ${
            isActive
              ? `animate-pulse ${accent.dot} ring-2 ring-[var(--color-border-glow)]`
              : isCompleted
                ? 'bg-[var(--color-status-success)]'
                : 'bg-[var(--color-surface-3)]'
          }`}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">{row.agentName}</span>
        </div>

        {agent && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
              {(() => {
                const prov = inferProvider(agent.model);
                return prov ? <ProviderIcon provider={prov} className="size-2.5" /> : null;
              })()}
              {formatModel(agent.model)}
            </span>
            {agent.reasoningEffort && (
              <>
                <span className="text-[10px] text-[var(--color-text-muted)]">·</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-muted)]">
                  <Sparkles className="size-2" />
                  {formatEffort(agent.reasoningEffort)}
                </span>
              </>
            )}
          </div>
        )}

        <div className="mt-1 flex items-center gap-1">
          <span
            className={`text-[10px] ${
              isActive
                ? accent.label
                : isCompleted
                  ? 'text-[var(--color-status-success)]'
                  : 'text-[var(--color-text-muted)]'
            }`}
          >
            {formatAgentActivityLabel(row.activity)}
          </span>
        </div>

        {agentUsage && agentUsage.requestCount > 0 && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
            <span className="font-mono tabular-nums">{formatTokenCount(agentUsage.inputTokens)} in</span>
            <span className="text-[var(--color-text-muted)]">·</span>
            <span className="font-mono tabular-nums">{formatTokenCount(agentUsage.outputTokens)} out</span>
            {agentUsage.cost > 0 && (
              <>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="font-mono tabular-nums">{agentUsage.cost.toFixed(2)} cost</span>
              </>
            )}
            {agentUsage.durationMs > 0 && (
              <>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="font-mono tabular-nums">{formatDuration(agentUsage.durationMs)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
