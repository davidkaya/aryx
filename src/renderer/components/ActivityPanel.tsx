import { useMemo } from 'react';
import { Activity } from 'lucide-react';

import {
  buildAgentActivityRows,
  formatAgentActivityLabel,
  isAgentActivityActive,
  isAgentActivityCompleted,
  type SessionActivityState,
} from '@renderer/lib/sessionActivity';
import type { PatternDefinition } from '@shared/domain/pattern';
import type { SessionRecord } from '@shared/domain/session';

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

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          {activityRows.map((row) => (
            <div className="flex items-start gap-2.5" key={row.key}>
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${
                  isAgentActivityActive(row.activity)
                    ? 'animate-pulse bg-blue-400'
                    : isAgentActivityCompleted(row.activity)
                      ? 'bg-emerald-400'
                      : 'bg-zinc-700'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-zinc-300">
                  {row.agentName}
                </div>
                <div className="truncate text-[12px] text-zinc-500">
                  {formatAgentActivityLabel(row.activity)}
                </div>
              </div>
            </div>
          ))}
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
