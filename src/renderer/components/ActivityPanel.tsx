import { useMemo, type ReactNode } from 'react';
import { Activity, ArrowRight, BarChart3, CheckCircle2, Clock, Cog, ShieldAlert, Sparkles, Users, Zap } from 'lucide-react';

import {
  buildAgentActivityRows,
  formatAgentActivityLabel,
  formatDuration,
  formatNanoAiu,
  formatTokenCount,
  isAgentActivityActive,
  isAgentActivityCompleted,
  type AgentActivityRow,
  type AgentUsageAccumulator,
  type SessionActivityState,
  type SessionRequestUsageState,
  type TurnEventLog,
} from '@renderer/lib/sessionActivity';
import { RunTimeline } from '@renderer/components/RunTimeline';
import { inferProvider } from '@shared/domain/models';
import type { OrchestrationMode, PatternAgentDefinition, PatternDefinition } from '@shared/domain/pattern';
import type { SessionRecord } from '@shared/domain/session';
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
  agentUsage,
}: {
  row: AgentActivityRow;
  agent?: PatternAgentDefinition;
  accent: (typeof modeAccent)[OrchestrationMode];
  isLast: boolean;
  agentUsage?: AgentUsageAccumulator;
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

        {/* Per-agent usage summary */}
        {agentUsage && agentUsage.requestCount > 0 && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-600">
            <span className="tabular-nums">{formatTokenCount(agentUsage.inputTokens)} in</span>
            <span className="text-zinc-700">·</span>
            <span className="tabular-nums">{formatTokenCount(agentUsage.outputTokens)} out</span>
            {agentUsage.cost > 0 && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="tabular-nums">{agentUsage.cost.toFixed(2)} cost</span>
              </>
            )}
            {agentUsage.durationMs > 0 && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="tabular-nums">{formatDuration(agentUsage.durationMs)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Turn event helpers ─────────────────────────────────────── */

import type { SessionEventKind } from '@shared/domain/event';

function TurnEventIcon({ kind, phase, success }: { kind: SessionEventKind; phase?: string; success?: boolean }) {
  const base = 'size-3';
  switch (kind) {
    case 'subagent':
      return <ArrowRight className={`${base} ${success === false ? 'text-red-400' : 'text-sky-400'}`} />;
    case 'hook-lifecycle':
      return <Cog className={`${base} ${phase === 'start' ? 'animate-spin text-amber-400' : success === false ? 'text-red-400' : 'text-emerald-400'}`} />;
    case 'skill-invoked':
      return <Sparkles className={`${base} text-violet-400`} />;
    case 'session-compaction':
      return <CheckCircle2 className={`${base} ${phase === 'start' ? 'animate-pulse text-amber-400' : 'text-emerald-400'}`} />;
    default:
      return <Zap className={`${base} text-zinc-500`} />;
  }
}

function formatTurnEventTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

/* ── ActivityPanel ─────────────────────────────────────────── */

interface ActivityPanelProps {
  activity?: SessionActivityState;
  onJumpToMessage?: (messageId: string) => void;
  pattern: PatternDefinition;
  session: SessionRecord;
  sessionRequestUsage?: SessionRequestUsageState;
  turnEvents?: TurnEventLog;
}

export function ActivityPanel({
  activity,
  onJumpToMessage,
  pattern,
  session,
  sessionRequestUsage,
  turnEvents,
}: ActivityPanelProps) {
  const activityRows = useMemo(
    () => buildAgentActivityRows(activity, pattern.agents),
    [activity, pattern.agents],
  );

  const isBusy = session.status === 'running';
  const hasPendingApproval = session.pendingApproval?.status === 'pending';
  const queuedCount = (session.pendingApprovalQueue ?? []).filter((a) => a.status === 'pending').length;
  const totalApprovalCount = (hasPendingApproval ? 1 : 0) + queuedCount;
  const accent = modeAccent[pattern.mode] ?? modeAccent.single;

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
              <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                Approval{totalApprovalCount > 1 ? `s (${totalApprovalCount})` : ''}
              </span>
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
              {activityRows.map((row, index) => {
                const agentKey = row.activity?.agentId ?? row.key;
                const agentUsage = sessionRequestUsage?.perAgent[agentKey]
                  ?? sessionRequestUsage?.perAgent[row.agentName];
                return (
                  <AgentRow
                    accent={accent}
                    agent={pattern.agents[index]}
                    agentUsage={agentUsage}
                    isLast={index === activityRows.length - 1}
                    key={row.key}
                    row={row}
                  />
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-[11px] text-zinc-600">No agents configured</p>
          )}
        </div>

        {/* ── Session usage section ──────────────────────────── */}
        {sessionRequestUsage && sessionRequestUsage.requestCount > 0 && (
          <div className="mb-4">
            <SectionHeader>
              <BarChart3 className="size-3" />
              <span>Session Usage</span>
            </SectionHeader>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                <span className="font-medium tabular-nums">
                  {sessionRequestUsage.requestCount} premium request{sessionRequestUsage.requestCount === 1 ? '' : 's'}
                </span>
                {sessionRequestUsage.totalNanoAiu > 0 && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="tabular-nums">{formatNanoAiu(sessionRequestUsage.totalNanoAiu)} AIU</span>
                  </>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                <span className="tabular-nums">{formatTokenCount(sessionRequestUsage.totalInputTokens)} in</span>
                <span className="text-zinc-700">·</span>
                <span className="tabular-nums">{formatTokenCount(sessionRequestUsage.totalOutputTokens)} out</span>
                {sessionRequestUsage.totalCost > 0 && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="tabular-nums">{sessionRequestUsage.totalCost.toFixed(2)} cost</span>
                  </>
                )}
                {sessionRequestUsage.totalDurationMs > 0 && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="tabular-nums">{formatDuration(sessionRequestUsage.totalDurationMs)} total</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

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

        {/* ── Turn events section ─────────────────────────── */}
        {turnEvents && turnEvents.length > 0 && (
          <div className="mb-4">
            <SectionHeader>
              <Zap className="size-3" />
              <span>Events</span>
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-500">
                {turnEvents.length}
              </span>
            </SectionHeader>

            <div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
              {turnEvents.slice().reverse().map((entry, index) => (
                <div key={index} className="flex items-start gap-2 py-1">
                  <div className="mt-0.5 shrink-0">
                    <TurnEventIcon kind={entry.kind} phase={entry.phase} success={entry.success} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-zinc-300">{entry.label}</span>
                      <span className="ml-auto shrink-0 text-[9px] tabular-nums text-zinc-700">
                        {formatTurnEventTimestamp(entry.occurredAt)}
                      </span>
                    </div>
                    {entry.detail && (
                      <p className="text-[10px] leading-snug text-zinc-600">{entry.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}


