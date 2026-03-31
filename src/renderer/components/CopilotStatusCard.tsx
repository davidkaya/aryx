import { useEffect, useState } from 'react';
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
  ArrowUpCircle,
  User,
  Building2,
  BarChart3,
  Loader2,
} from 'lucide-react';

import { CliInstallGuide } from '@renderer/components/settings/CliInstallGuide';
import type {
  SidecarConnectionDiagnostics,
  SidecarConnectionStatus,
  SidecarCopilotCliVersionStatus,
  QuotaSnapshot,
} from '@shared/contracts/sidecar';

interface CopilotStatusCardProps {
  connection?: SidecarConnectionDiagnostics;
  modelCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onGetQuota?: () => Promise<Record<string, QuotaSnapshot>>;
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
        icon: <CheckCircle2 className="size-4 text-[var(--color-status-success)]" />,
        label: 'Connected to GitHub Copilot',
        accentClasses: 'text-[var(--color-status-success)]',
        dotClasses: 'bg-[var(--color-status-success)]',
      };
    case 'copilot-cli-missing':
      return {
        icon: <Download className="size-4 text-[var(--color-status-warning)]" />,
        label: 'Copilot CLI not found',
        accentClasses: 'text-[var(--color-status-warning)]',
        dotClasses: 'bg-[var(--color-status-warning)]',
        actionIcon: <Terminal className="size-3" />,
        actionLabel: 'Install the copilot CLI and ensure it is on your PATH',
      };
    case 'copilot-auth-required':
      return {
        icon: <LogIn className="size-4 text-[var(--color-status-info)]" />,
        label: 'Sign-in required',
        accentClasses: 'text-[var(--color-status-info)]',
        dotClasses: 'bg-[var(--color-status-info)]',
        actionIcon: <Terminal className="size-3" />,
        actionLabel: 'Run copilot auth login in your terminal, then refresh',
      };
    case 'copilot-error':
      return {
        icon: <XCircle className="size-4 text-[var(--color-status-error)]" />,
        label: 'Connection error',
        accentClasses: 'text-[var(--color-status-error)]',
        dotClasses: 'bg-[var(--color-status-error)]',
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

function VersionBadge({ status, installedVersion }: { status: SidecarCopilotCliVersionStatus; installedVersion?: string }) {
  const versionLabel = installedVersion ? `v${installedVersion}` : undefined;

  switch (status) {
    case 'latest':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-status-success)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-status-success)]">
          <CheckCircle2 className="size-2.5" />
          {versionLabel ?? 'Up to date'}
        </span>
      );
    case 'outdated':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-status-warning)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-status-warning)]">
          <ArrowUpCircle className="size-2.5" />
          Update available
        </span>
      );
    case 'unknown':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          {versionLabel ?? 'Version unknown'}
        </span>
      );
  }
}

const quotaTypeLabels: Record<string, string> = {
  premium_interactions: 'Premium Requests',
  chat: 'Chat',
  completions: 'Completions',
};

function formatQuotaTypeLabel(key: string): string {
  return quotaTypeLabels[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatResetDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / 86_400_000);

    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays <= 30) return `In ${diffDays} day${diffDays === 1 ? '' : 's'}`;

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function QuotaSection({
  onGetQuota,
}: {
  onGetQuota: () => Promise<Record<string, QuotaSnapshot>>;
}) {
  const [quotaData, setQuotaData] = useState<Record<string, QuotaSnapshot>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    void onGetQuota()
      .then((data) => { if (!cancelled) setQuotaData(data); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [onGetQuota]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="size-3.5 animate-spin text-[var(--color-text-muted)]" />
        <span className="text-[12px] text-[var(--color-text-muted)]">Loading quota…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2">
        <XCircle className="size-3.5 text-[var(--color-status-error)]" />
        <span className="text-[12px] text-[var(--color-text-muted)]">Could not load quota</span>
      </div>
    );
  }

  if (!quotaData || Object.keys(quotaData).length === 0) {
    return (
      <div className="py-2">
        <span className="text-[12px] text-[var(--color-text-muted)]">No quota data available</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Object.entries(quotaData).map(([key, snapshot]) => {
        const usedPct = snapshot.entitlementRequests > 0
          ? (snapshot.usedRequests / snapshot.entitlementRequests) * 100
          : 0;
        const barColor = usedPct > 90
          ? 'bg-[var(--color-status-error)]'
          : usedPct > 70
            ? 'bg-[var(--color-status-warning)]'
            : 'bg-[var(--color-accent)]/60';

        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                {formatQuotaTypeLabel(key)}
              </span>
              <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">
                {Math.round(snapshot.remainingPercentage)}% remaining
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(100, usedPct)}%` }}
              />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="tabular-nums">
                {Math.round(snapshot.usedRequests)} of {Math.round(snapshot.entitlementRequests)} used
              </span>
              {snapshot.overage > 0 && (
                <>
                  <span className="text-[var(--color-text-muted)]">·</span>
                  <span className="tabular-nums text-[var(--color-status-warning)]">
                    {Math.round(snapshot.overage)} overage
                  </span>
                </>
              )}
              {snapshot.resetDate && (
                <>
                  <span className="text-[var(--color-text-muted)]">·</span>
                  <span>Resets {formatResetDate(snapshot.resetDate)}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AccountSection({ connection }: { connection: SidecarConnectionDiagnostics }) {
  const { account } = connection;
  if (!account) return null;

  const hasLogin = !!account.login;
  const hasOrgs = account.organizations && account.organizations.length > 0;
  if (!hasLogin && !account.statusMessage) return null;

  const MAX_VISIBLE_ORGS = 5;
  const visibleOrgs = hasOrgs ? account.organizations!.slice(0, MAX_VISIBLE_ORGS) : [];
  const remainingOrgs = hasOrgs ? account.organizations!.length - MAX_VISIBLE_ORGS : 0;

  return (
    <div className="space-y-2.5">
      {/* Identity row */}
      <div className="flex items-center gap-2">
        <User className="size-3.5 text-[var(--color-text-muted)]" />
        {hasLogin ? (
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="font-medium text-[var(--color-text-primary)]">{account.login}</span>
            {account.host && (
              <span className="text-[var(--color-text-muted)]">· {account.host}</span>
            )}
          </div>
        ) : (
          <span className="text-[12px] text-[var(--color-text-muted)]">{account.statusMessage}</span>
        )}
      </div>

      {/* Organizations */}
      {hasOrgs && (
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-muted)]" />
          <div className="flex flex-wrap items-center gap-1">
            {visibleOrgs.map((org) => (
              <span
                className="rounded-md bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]"
                key={org}
              >
                {org}
              </span>
            ))}
            {remainingOrgs > 0 && (
              <span className="text-[10px] text-[var(--color-text-muted)]">+{remainingOrgs} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CopilotStatusCard({
  connection,
  modelCount,
  isRefreshing,
  onRefresh,
  onGetQuota,
}: CopilotStatusCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!connection) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] px-4 py-3">
        <Cpu className="size-4 text-[var(--color-text-muted)]" />
        <span className="text-[13px] text-[var(--color-text-muted)]">Checking connection…</span>
        <RefreshCw className="ml-auto size-3.5 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  const config = getStatusConfig(connection.status);
  const isHealthy = connection.status === 'ready';
  const hasDetail = connection.copilotCliPath;
  const checkedLabel = formatCheckedAt(connection.checkedAt);
  const hasVersionInfo = !!connection.copilotCliVersion;
  const hasAccountInfo = !!connection.account;

  return (
    <div className="space-y-3">
      {/* Status indicator */}
      <div className="flex items-center gap-3">
        <div className={`size-2 shrink-0 rounded-full ${config.dotClasses}`} />
        <span className={`text-[13px] font-medium ${config.accentClasses}`}>
          {config.label}
        </span>
        {isHealthy && (
          <span className="text-[12px] text-[var(--color-text-muted)]">
            · {modelCount} model{modelCount === 1 ? '' : 's'} available
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {hasVersionInfo && (
            <VersionBadge
              installedVersion={connection.copilotCliVersion!.installedVersion}
              status={connection.copilotCliVersion!.status}
            />
          )}
          {checkedLabel && (
            <span className="text-[11px] text-[var(--color-text-muted)]">{checkedLabel}</span>
          )}
          <button
            className="flex size-6 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)] disabled:opacity-50"
            disabled={isRefreshing}
            onClick={onRefresh}
            title="Refresh connection status"
            type="button"
          >
            <RefreshCw className={`size-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Account info (when healthy) */}
      {isHealthy && hasAccountInfo && (
        <AccountSection connection={connection} />
      )}

      {/* Usage & Quota (when healthy and callback provided) */}
      {isHealthy && onGetQuota && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
            <BarChart3 className="size-3" />
            <span>Usage &amp; Quota</span>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-glass)] px-3 py-2.5">
            <QuotaSection onGetQuota={onGetQuota} />
          </div>
        </div>
      )}

      {/* Installation guide for missing CLI */}
      {connection.status === 'copilot-cli-missing' && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass)] p-4">
          <CliInstallGuide isRefreshing={isRefreshing} onRefresh={onRefresh} />
        </div>
      )}

      {/* Action hint for other non-ready states */}
      {!isHealthy && connection.status !== 'copilot-cli-missing' && config.actionLabel && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-glass)] px-3 py-2.5">
          <div className="mt-0.5 shrink-0">{config.actionIcon}</div>
          <p className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">{config.actionLabel}</p>
        </div>
      )}

      {/* Expandable details (healthy state) */}
      {isHealthy && hasDetail && (
        <div className="space-y-2">
          <button
            className="flex w-full items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] transition-all duration-200 hover:text-[var(--color-text-secondary)]"
            onClick={() => setShowDetails((prev) => !prev)}
            type="button"
          >
            {showDetails ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <span>Details</span>
          </button>

          {showDetails && (
            <div className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-glass)]">
              {connection.copilotCliPath && (
                <div className="border-b border-[var(--color-border-subtle)] px-3 py-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">CLI path</span>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--color-text-secondary)]" title={connection.copilotCliPath}>
                    {connection.copilotCliPath}
                  </p>
                </div>
              )}
              {hasVersionInfo && connection.copilotCliVersion!.status === 'outdated' && connection.copilotCliVersion!.latestVersion && (
                <div className="border-b border-[var(--color-border-subtle)] px-3 py-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Latest version</span>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {connection.copilotCliVersion!.latestVersion}
                  </p>
                </div>
              )}
              <div className="px-3 py-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Last checked</span>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                  {new Date(connection.checkedAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error detail for non-ready states */}
      {!isHealthy && hasDetail && (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-glass)]">
          <div className="border-b border-[var(--color-border-subtle)] px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">CLI path</span>
            <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--color-text-secondary)]" title={connection.copilotCliPath}>
              {shortenPath(connection.copilotCliPath!)}
            </p>
          </div>
          {connection.detail && (
            <div className="px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Error detail</span>
              <p className="mt-0.5 break-words text-[11px] text-[var(--color-text-secondary)]">{connection.detail}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
