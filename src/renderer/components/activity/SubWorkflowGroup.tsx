import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, GitBranch } from 'lucide-react';

import type { AgentNodeConfig } from '@shared/domain/workflow';
import {
  isAgentActivityActive,
  type AgentUsageAccumulator,
  type SubWorkflowActivityGroup,
} from '@renderer/lib/sessionActivity';
import { AgentRow } from './AgentRow';
import { modeAccent, modeLabels } from './constants';

interface SubWorkflowGroupProps {
  group: SubWorkflowActivityGroup;
  agentConfigs: ReadonlyArray<AgentNodeConfig>;
  agentUsage?: Record<string, AgentUsageAccumulator>;
}

const statusPresentation = {
  idle: {
    dot: 'bg-[var(--color-surface-3)]',
    text: 'text-[var(--color-text-muted)]',
    label: 'Idle',
  },
  running: {
    dot: 'animate-pulse',
    text: '',
    label: 'Running',
  },
  completed: {
    dot: 'bg-[var(--color-status-success)]',
    text: 'text-[var(--color-status-success)]',
    label: 'Done',
  },
} as const;

export function SubWorkflowGroup({ group, agentConfigs, agentUsage }: SubWorkflowGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const prevStatusRef = useRef(group.status);

  useEffect(() => {
    if (prevStatusRef.current !== 'running' && group.status === 'running') {
      setIsExpanded(true);
    }
    prevStatusRef.current = group.status;
  }, [group.status]);

  const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);

  const accent = modeAccent[group.orchestrationMode] ?? modeAccent.single;
  const status = statusPresentation[group.status];
  const hasActiveAgent = group.agents.some((a) => isAgentActivityActive(a.activity));

  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] border-l-[3px] bg-[var(--color-surface-1)]"
      style={{ borderLeftColor: accent.color }}
      role="group"
      aria-label={`Sub-workflow: ${group.name}`}
    >
      {/* Collapsible header */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={isExpanded}
        type="button"
      >
        <GitBranch className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />

        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-primary)]">
          {group.name}
        </span>

        {/* Status badge */}
        <span className="flex items-center gap-1" aria-live="polite">
          <span
            className={`size-1.5 rounded-full ${
              group.status === 'running'
                ? `${accent.dot} ${status.dot} ring-1 ring-[var(--color-border-glow)]`
                : status.dot
            }`}
          />
          <span className={`text-[9px] font-medium ${group.status === 'running' ? accent.label : status.text}`}>
            {status.label}
          </span>
        </span>

        {/* Agent count pill */}
        <span className="font-mono rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[9px] tabular-nums text-[var(--color-text-muted)]">
          {group.agents.length}
        </span>

        <ChevronDown
          className={`size-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expandable agent list */}
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="relative border-t border-[var(--color-border-subtle)] py-1 pl-5 pr-3">
            {/* Connecting vertical accent line */}
            {hasActiveAgent && (
              <div className={`absolute bottom-3 left-[11px] top-3 w-px ${accent.bar}`} />
            )}

            {group.agents.map((row, index) => {
              const agent = agentConfigs.find((c) => c.id === row.key || c.name === row.agentName);
              const usage = agentUsage?.[row.activity?.agentId ?? row.key] ?? agentUsage?.[row.agentName];

              return (
                <AgentRow
                  key={row.key}
                  row={row}
                  agent={agent}
                  accent={accent}
                  isLast={index === group.agents.length - 1}
                  agentUsage={usage}
                />
              );
            })}

            {/* Mode label */}
            <div className="flex items-center gap-1 pb-1 pt-0.5">
              <span className={`text-[9px] font-medium ${accent.label}`}>
                {modeLabels[group.orchestrationMode]}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
