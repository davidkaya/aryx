import { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Terminal,
  LogIn,
  Download,
  Cpu,
} from 'lucide-react';

import type {
  SidecarConnectionDiagnostics,
  SidecarConnectionStatus,
} from '@shared/contracts/sidecar';

interface CopilotStatusCardProps {
  connection?: SidecarConnectionDiagnostics;
  modelCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
}

interface StatusConfig {
  icon: React.ReactNode;
  label: string;
  accentClasses: string;
  borderClasses: string;
  bgClasses: string;
  actionIcon?: React.ReactNode;
  actionLabel?: string;
}

function getStatusConfig(status: SidecarConnectionStatus): StatusConfig {
  switch (status) {
    case 'ready':
      return {
        icon: <CheckCircle2 className="size-4 text-emerald-400" />,
        label: 'Connected',
        accentClasses: 'text-emerald-400',
        borderClasses: 'border-emerald-500/20',
        bgClasses: 'bg-emerald-500/5',
      };
    case 'copilot-cli-missing':
      return {
        icon: <Download className="size-4 text-amber-400" />,
        label: 'CLI Not Found',
        accentClasses: 'text-amber-400',
        borderClasses: 'border-amber-500/20',
        bgClasses: 'bg-amber-500/5',
        actionIcon: <Terminal className="size-3" />,
        actionLabel: 'Install Copilot CLI',
      };
    case 'copilot-auth-required':
      return {
        icon: <LogIn className="size-4 text-blue-400" />,
        label: 'Sign-in Required',
        accentClasses: 'text-blue-400',
        borderClasses: 'border-blue-500/20',
        bgClasses: 'bg-blue-500/5',
        actionIcon: <Terminal className="size-3" />,
        actionLabel: 'Run copilot auth login',
      };
    case 'copilot-error':
      return {
        icon: <XCircle className="size-4 text-red-400" />,
        label: 'Connection Error',
        accentClasses: 'text-red-400',
        borderClasses: 'border-red-500/20',
        bgClasses: 'bg-red-500/5',
      };
  }
}

function formatCheckedAt(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function CopilotStatusCard({
  connection,
  modelCount,
  isRefreshing,
  onRefresh,
}: CopilotStatusCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!connection) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-zinc-900/40 p-4">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-zinc-600" />
          <span className="text-[13px] text-zinc-500">Checking Copilot connection…</span>
          <RefreshCw className="ml-auto size-3.5 animate-spin text-zinc-600" />
        </div>
      </div>
    );
  }

  const config = getStatusConfig(connection.status);
  const isHealthy = connection.status === 'ready';
  const hasDetail = connection.detail || connection.copilotCliPath;
  const checkedLabel = formatCheckedAt(connection.checkedAt);

  return (
    <div className={`rounded-xl border ${config.borderClasses} ${config.bgClasses} p-4 transition-colors`}>
      {/* Main status row */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{config.icon}</div>

        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-semibold ${config.accentClasses}`}>
              {config.label}
            </span>
            {isHealthy && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                {modelCount} model{modelCount === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {/* Summary */}
          <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">
            {connection.summary}
          </p>

          {/* Action hint for non-ready states */}
          {!isHealthy && config.actionLabel && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-zinc-800/60 px-2.5 py-1.5 text-[11px] text-zinc-400">
              {config.actionIcon}
              <span>{config.actionLabel}</span>
            </div>
          )}
        </div>

        {/* Refresh button */}
        <button
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
          disabled={isRefreshing}
          onClick={onRefresh}
          title="Refresh connection status"
          type="button"
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Expandable details */}
      {hasDetail && (
        <div className="mt-3 border-t border-zinc-800/60 pt-2">
          <button
            className="flex w-full items-center gap-1 text-[11px] text-zinc-600 transition hover:text-zinc-400"
            onClick={() => setShowDetails((prev) => !prev)}
            type="button"
          >
            {showDetails ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <span>Technical details</span>
            {checkedLabel && (
              <span className="ml-auto text-[10px] text-zinc-700">
                checked {checkedLabel}
              </span>
            )}
          </button>

          {showDetails && (
            <div className="mt-2 space-y-1.5 rounded-lg bg-zinc-900/60 px-3 py-2 text-[11px] font-mono text-zinc-500">
              {connection.copilotCliPath && (
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-zinc-600">CLI path</span>
                  <span className="truncate text-zinc-400">{connection.copilotCliPath}</span>
                </div>
              )}
              {connection.detail && (
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-zinc-600">Detail</span>
                  <span className="break-words text-zinc-400">{connection.detail}</span>
                </div>
              )}
              {checkedLabel && (
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-zinc-600">Checked</span>
                  <span className="text-zinc-400">{connection.checkedAt}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
