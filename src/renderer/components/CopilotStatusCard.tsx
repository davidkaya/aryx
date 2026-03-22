import { useState } from 'react';
import {
  CheckCircle2,
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
  dotClasses: string;
  actionIcon?: React.ReactNode;
  actionLabel?: string;
}

function getStatusConfig(status: SidecarConnectionStatus): StatusConfig {
  switch (status) {
    case 'ready':
      return {
        icon: <CheckCircle2 className="size-4 text-emerald-400" />,
        label: 'Connected to GitHub Copilot',
        accentClasses: 'text-emerald-400',
        dotClasses: 'bg-emerald-400',
      };
    case 'copilot-cli-missing':
      return {
        icon: <Download className="size-4 text-amber-400" />,
        label: 'Copilot CLI not found',
        accentClasses: 'text-amber-400',
        dotClasses: 'bg-amber-400',
        actionIcon: <Terminal className="size-3" />,
        actionLabel: 'Install the copilot CLI and ensure it is on your PATH',
      };
    case 'copilot-auth-required':
      return {
        icon: <LogIn className="size-4 text-blue-400" />,
        label: 'Sign-in required',
        accentClasses: 'text-blue-400',
        dotClasses: 'bg-blue-400',
        actionIcon: <Terminal className="size-3" />,
        actionLabel: 'Run copilot auth login in your terminal, then refresh',
      };
    case 'copilot-error':
      return {
        icon: <XCircle className="size-4 text-red-400" />,
        label: 'Connection error',
        accentClasses: 'text-red-400',
        dotClasses: 'bg-red-400',
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

function shortenPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return fullPath;
  return `…/${parts.slice(-2).join('/')}`;
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
      <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-zinc-900/40 px-4 py-3">
        <Cpu className="size-4 text-zinc-600" />
        <span className="text-[13px] text-zinc-500">Checking connection…</span>
        <RefreshCw className="ml-auto size-3.5 animate-spin text-zinc-600" />
      </div>
    );
  }

  const config = getStatusConfig(connection.status);
  const isHealthy = connection.status === 'ready';
  const hasDetail = connection.copilotCliPath;
  const checkedLabel = formatCheckedAt(connection.checkedAt);

  return (
    <div className="space-y-3">
      {/* Status indicator */}
      <div className="flex items-center gap-3">
        <div className={`size-2 shrink-0 rounded-full ${config.dotClasses}`} />
        <span className={`text-[13px] font-medium ${config.accentClasses}`}>
          {config.label}
        </span>
        {isHealthy && (
          <span className="text-[12px] text-zinc-500">
            · {modelCount} model{modelCount === 1 ? '' : 's'} available
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {checkedLabel && (
            <span className="text-[11px] text-zinc-600">{checkedLabel}</span>
          )}
          <button
            className="flex size-6 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
            disabled={isRefreshing}
            onClick={onRefresh}
            title="Refresh connection status"
            type="button"
          >
            <RefreshCw className={`size-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Action hint for non-ready states */}
      {!isHealthy && config.actionLabel && (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
          <div className="mt-0.5 shrink-0">{config.actionIcon}</div>
          <p className="text-[12px] leading-relaxed text-zinc-400">{config.actionLabel}</p>
        </div>
      )}

      {/* CLI path (always visible when healthy, expandable otherwise) */}
      {isHealthy && hasDetail && (
        <div className="space-y-2">
          <button
            className="flex w-full items-center gap-1.5 text-[11px] text-zinc-600 transition hover:text-zinc-400"
            onClick={() => setShowDetails((prev) => !prev)}
            type="button"
          >
            {showDetails ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <span>Details</span>
          </button>

          {showDetails && (
            <div className="overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-900/40">
              {connection.copilotCliPath && (
                <div className="border-b border-zinc-800/40 px-3 py-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">CLI path</span>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-400" title={connection.copilotCliPath}>
                    {connection.copilotCliPath}
                  </p>
                </div>
              )}
              <div className="px-3 py-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Last checked</span>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {new Date(connection.checkedAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error detail for non-ready states */}
      {!isHealthy && hasDetail && (
        <div className="overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-900/40">
          <div className="border-b border-zinc-800/40 px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">CLI path</span>
            <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-400" title={connection.copilotCliPath}>
              {shortenPath(connection.copilotCliPath!)}
            </p>
          </div>
          {connection.detail && (
            <div className="px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Error detail</span>
              <p className="mt-0.5 break-words text-[11px] text-zinc-400">{connection.detail}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
