import { useMemo, type ReactNode } from 'react';
import { Activity, ArrowRight, BarChart3, CheckCircle2, Clock, Cog, GitBranch as GitBranchIcon, ShieldAlert, Sparkles, Users, Zap } from 'lucide-react';

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
import { GitPanel } from '@renderer/components/GitPanel';
import { inferProvider } from '@shared/domain/models';
import type { OrchestrationMode, PatternAgentDefinition, PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject } from '@shared/domain/project';
import type { ProjectGitFileReference } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { ProviderIcon } from './ProviderIcons';

/* ── Mode accent colours ───────────────────────────────────── */

const modeAccent: Record<OrchestrationMode, { dot: string; bar: string; label: string }> = {
  single:       { dot: 'bg-[#245CF9]',                       bar: 'bg-[#245CF9] opacity-60',                       label: 'text-[#245CF9]' },
  sequential:   { dot: 'bg-[var(--color-status-warning)]',   bar: 'bg-[var(--color-status-warning)] opacity-60',   label: 'text-[var(--color-status-warning)]' },
  concurrent:   { dot: 'bg-[var(--color-status-success)]',   bar: 'bg-[var(--color-status-success)] opacity-60',   label: 'text-[var(--color-status-success)]' },
  handoff:      { dot: 'bg-[var(--color-accent-sky)]',       bar: 'bg-[var(--color-accent-sky)] opacity-60',       label: 'text-[var(--color-accent-sky)]' },
  'group-chat': { dot: 'bg-[var(--color-accent-purple)]',   bar: 'bg-[var(--color-accent-purple)] opacity-60',   label: 'text-[var(--color-accent-purple)]' },
  magentic:     { dot: 'bg-[var(--color-text-muted)]',       bar: 'bg-[var(--color-text-muted)] opacity-60',       label: 'text-[var(--color-text-muted)]' },
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
    <h3 className="font-display mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
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
    <div className={`relative flex gap-2.5 py-2.5 ${isLast ? '' : 'border-b border-[var(--color-border-subtle)]'}`}>
      {/* Left accent bar — visible only when this agent is actively working */}
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

        {/* Model + effort inline */}
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

        {/* Activity label */}
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

        {/* Per-agent usage summary */}
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

/* ── Turn event helpers ─────────────────────────────────────── */

import type { SessionEventKind } from '@shared/domain/event';

function TurnEventIcon({ kind, phase, success }: { kind: SessionEventKind; phase?: string; success?: boolean }) {
  const base = 'size-3';
  switch (kind) {
    case 'subagent':
      return <ArrowRight className={`${base} ${success === false ? 'text-[var(--color-status-error)]' : 'text-[var(--color-accent-sky)]'}`} />;
    case 'hook-lifecycle':
      return <Cog className={`${base} ${phase === 'start' ? 'animate-spin text-[var(--color-status-warning)]' : success === false ? 'text-[var(--color-status-error)]' : 'text-[var(--color-status-success)]'}`} />;
    case 'skill-invoked':
      return <Sparkles className={`${base} text-[var(--color-accent-purple)]`} />;
    case 'session-compaction':
      return <CheckCircle2 className={`${base} ${phase === 'start' ? 'animate-pulse text-[var(--color-status-warning)]' : 'text-[var(--color-status-success)]'}`} />;
    default:
      return <Zap className={`${base} text-[var(--color-text-muted)]`} />;
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
  onDiscard?: (sessionId: string, runId: string, files?: ProjectGitFileReference[]) => Promise<unknown>;
  onOpenCommitComposer?: () => void;
  pattern: PatternDefinition;
  session: SessionRecord;
  sessionRequestUsage?: SessionRequestUsageState;
  turnEvents?: TurnEventLog;
}

export function ActivityPanel({
  activity,
  onJumpToMessage,
  onDiscard,
  onOpenCommitComposer,
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
          <Activity className="size-4 text-[var(--color-text-muted)]" />
          <span className="font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
            Activity
          </span>
          {hasPendingApproval ? (
            <span className="flex items-center gap-1">
              <ShieldAlert className="size-3 text-[var(--color-status-warning)]" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-status-warning)]">
                Approval{totalApprovalCount > 1 ? `s (${totalApprovalCount})` : ''}
              </span>
            </span>
          ) : isBusy ? (
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--color-status-info)]" />
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* ── Agents section ───────────────────────────────── */}
        <div className="mb-4">
          <SectionHeader>
            <Users className="size-3" />
            <span>Agents</span>
            <span className="font-mono rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[9px] tabular-nums text-[var(--color-text-muted)]">
              {activityRows.length}
            </span>
            <span className={`ml-auto text-[9px] font-medium normal-case tracking-normal ${accent.label}`}>
              {modeLabels[pattern.mode]}
            </span>
          </SectionHeader>

          {activityRows.length > 0 ? (
            <div className="glass-surface rounded-lg px-3">
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
            <p className="py-4 text-center text-[11px] text-[var(--color-text-muted)]">No agents configured</p>
          )}
        </div>

        {/* ── Session usage section ──────────────────────────── */}
        {sessionRequestUsage && sessionRequestUsage.requestCount > 0 && (
          <div className="mb-4">
            <SectionHeader>
              <BarChart3 className="size-3" />
              <span>Session Usage</span>
            </SectionHeader>

            <div className="glass-surface rounded-lg px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
                <span className="font-mono font-medium tabular-nums">
                  {sessionRequestUsage.requestCount} premium request{sessionRequestUsage.requestCount === 1 ? '' : 's'}
                </span>
                {sessionRequestUsage.totalNanoAiu > 0 && (
                  <>
                    <span className="text-[var(--color-text-muted)]">·</span>
                    <span className="font-mono tabular-nums">{formatNanoAiu(sessionRequestUsage.totalNanoAiu)} AIU</span>
                  </>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span className="font-mono tabular-nums">{formatTokenCount(sessionRequestUsage.totalInputTokens)} in</span>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="font-mono tabular-nums">{formatTokenCount(sessionRequestUsage.totalOutputTokens)} out</span>
                {sessionRequestUsage.totalCost > 0 && (
                  <>
                    <span className="text-[var(--color-text-muted)]">·</span>
                    <span className="font-mono tabular-nums">{sessionRequestUsage.totalCost.toFixed(2)} cost</span>
                  </>
                )}
                {sessionRequestUsage.totalDurationMs > 0 && (
                  <>
                    <span className="text-[var(--color-text-muted)]">·</span>
                    <span className="font-mono tabular-nums">{formatDuration(sessionRequestUsage.totalDurationMs)} total</span>
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
              <span className="font-mono rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[9px] tabular-nums text-[var(--color-text-muted)]">
                {session.runs.length}
              </span>
            )}
          </SectionHeader>

          <RunTimeline
            onDiscard={onDiscard}
            onJumpToMessage={onJumpToMessage}
            onOpenCommitComposer={onOpenCommitComposer}
            runs={session.runs}
            sessionId={session.id}
          />
        </div>

        {/* ── Turn events section ─────────────────────────── */}
        {turnEvents && turnEvents.length > 0 && (
          <div className="mb-4">
            <SectionHeader>
              <Zap className="size-3" />
              <span>Events</span>
              <span className="font-mono rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[9px] tabular-nums text-[var(--color-text-muted)]">
                {turnEvents.length}
              </span>
            </SectionHeader>

            <div className="glass-surface space-y-0.5 rounded-lg px-3 py-2">
              {turnEvents.slice().reverse().map((entry, index) => (
                <div key={index} className="flex items-start gap-2 py-1">
                  <div className="mt-0.5 shrink-0">
                    <TurnEventIcon kind={entry.kind} phase={entry.phase} success={entry.success} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">{entry.label}</span>
                      <span className="font-mono ml-auto shrink-0 text-[9px] tabular-nums text-[var(--color-text-muted)]">
                        {formatTurnEventTimestamp(entry.occurredAt)}
                      </span>
                    </div>
                    {entry.detail && (
                      <p className="text-[10px] leading-snug text-[var(--color-text-muted)]">{entry.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Git panel section ────────────────────────────── */}
        {!isScratchpadProject(session.projectId) && (
          <div className="mb-4">
            <SectionHeader>
              <GitBranchIcon className="size-3" />
              <span>Git</span>
            </SectionHeader>

            <GitPanel projectId={session.projectId} />
          </div>
        )}

      </div>
    </div>
  );
}


