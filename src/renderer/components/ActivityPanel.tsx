import { useMemo, type ReactNode } from 'react';
import { Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Cog, GitBranch, ShieldAlert, Sparkles, Users, Zap } from 'lucide-react';

import {
  buildAgentActivityRows,
  buildGroupedActivityRows,
  formatDuration,
  formatNanoAiu,
  formatTokenCount,
  type SessionActivityState,
  type SessionRequestUsageState,
  type TurnEventLog,
} from '@renderer/lib/sessionActivity';
import { resolveWorkflowAgentHierarchy, type AgentNodeConfig, type WorkflowDefinition } from '@shared/domain/workflow';
import type { SessionRecord } from '@shared/domain/session';
import { AgentRow } from './activity/AgentRow';
import { SubWorkflowGroup } from './activity/SubWorkflowGroup';
import { modeAccent, modeLabels } from './activity/constants';

/* ── Section header ────────────────────────────────────────── */

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
      {children}
    </h3>
  );
}

/* ── Turn event helpers ─────────────────────────────────────── */

import type { SessionEventKind } from '@shared/domain/event';

function TurnEventIcon({ kind, phase, success }: { kind: SessionEventKind; phase?: string; success?: boolean }) {
  const base = 'size-3';
  switch (kind) {
    case 'agent-activity':
      return <GitBranch className={`${base} ${phase === 'start' ? 'text-[var(--color-accent-sky)]' : 'text-[var(--color-status-success)]'}`} />;
    case 'subagent':
      return <ArrowRight className={`${base} ${success === false ? 'text-[var(--color-status-error)]' : 'text-[var(--color-accent-sky)]'}`} />;
    case 'hook-lifecycle':
      return <Cog className={`${base} ${phase === 'start' ? 'animate-spin text-[var(--color-status-warning)]' : success === false ? 'text-[var(--color-status-error)]' : 'text-[var(--color-status-success)]'}`} />;
    case 'skill-invoked':
      return <Sparkles className={`${base} text-[var(--color-accent-purple)]`} />;
    case 'session-compaction':
      return <CheckCircle2 className={`${base} ${phase === 'start' ? 'animate-pulse text-[var(--color-status-warning)]' : 'text-[var(--color-status-success)]'}`} />;
    case 'workflow-diagnostic':
      return <AlertTriangle className={`${base} ${success === false ? 'text-[var(--color-status-error)]' : 'text-[var(--color-status-warning)]'}`} />;
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
  workflow: WorkflowDefinition;
  workflows?: ReadonlyArray<WorkflowDefinition>;
  session: SessionRecord;
  sessionRequestUsage?: SessionRequestUsageState;
  turnEvents?: TurnEventLog;
}

export function ActivityPanel({
  activity,
  workflow,
  workflows,
  session,
  sessionRequestUsage,
  turnEvents,
}: ActivityPanelProps) {
  const resolveOptions = useMemo(() => ({
    resolveWorkflow: (id: string) => workflows?.find((w) => w.id === id),
  }), [workflows]);

  const hierarchy = useMemo(
    () => resolveWorkflowAgentHierarchy(workflow, resolveOptions),
    [workflow, resolveOptions],
  );

  const groupedRows = useMemo(
    () => buildGroupedActivityRows(activity, hierarchy),
    [activity, hierarchy],
  );

  const workflowMode = workflow.settings.orchestrationMode ?? 'single';
  const totalAgentCount = hierarchy.topLevelAgents.length
    + hierarchy.subWorkflows.reduce((sum, sw) => sum + sw.agents.length, 0);

  const isBusy = session.status === 'running';
  const hasPendingApproval = session.pendingApproval?.status === 'pending';
  const queuedCount = (session.pendingApprovalQueue ?? []).filter((a) => a.status === 'pending').length;
  const totalApprovalCount = (hasPendingApproval ? 1 : 0) + queuedCount;
  const accent = modeAccent[workflowMode] ?? modeAccent.single;

  const hasSubWorkflows = groupedRows.subWorkflows.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
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
              {totalAgentCount}
            </span>
            <span className={`ml-auto text-[9px] font-medium normal-case tracking-normal ${accent.label}`}>
              {modeLabels[workflowMode]}
            </span>
          </SectionHeader>

          {/* Top-level agents */}
          {groupedRows.topLevelAgents.length > 0 && (
            <div className="glass-surface rounded-lg px-3">
              {groupedRows.topLevelAgents.map((row, index) => {
                const agent = hierarchy.topLevelAgents.find((a) => a.id === row.key || a.name === row.agentName);
                const agentKey = row.activity?.agentId ?? row.key;
                const agentUsage = sessionRequestUsage?.perAgent[agentKey]
                  ?? sessionRequestUsage?.perAgent[row.agentName];
                return (
                  <AgentRow
                    key={row.key}
                    row={row}
                    agent={agent}
                    accent={accent}
                    isLast={!hasSubWorkflows && index === groupedRows.topLevelAgents.length - 1}
                    agentUsage={agentUsage}
                  />
                );
              })}
            </div>
          )}

          {/* Sub-workflow groups */}
          {hasSubWorkflows && (
            <div className={`space-y-2 ${groupedRows.topLevelAgents.length > 0 ? 'mt-2' : ''}`}>
              {groupedRows.subWorkflows.map((group) => {
                const subDef = hierarchy.subWorkflows.find((sw) => sw.nodeId === group.nodeId);
                return (
                  <SubWorkflowGroup
                    key={group.nodeId}
                    group={group}
                    agentConfigs={subDef?.agents ?? []}
                    agentUsage={sessionRequestUsage?.perAgent}
                  />
                );
              })}
            </div>
          )}

          {totalAgentCount === 0 && !hasSubWorkflows && (
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

      </div>
    </div>
  );
}
