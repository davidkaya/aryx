import { useCallback, useEffect, useMemo } from 'react';
import { Check, FileSearch, Server, X, XCircle } from 'lucide-react';

import type { DiscoveredMcpServer, DiscoveredToolingState } from '@shared/domain/discoveredTooling';
import { listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { ProjectDiscoveredTooling } from '@shared/domain/discoveredTooling';

/* ── Props ─────────────────────────────────────────────────── */

interface DiscoveredToolingModalProps {
  userDiscoveredTooling: DiscoveredToolingState;
  projectDiscoveredTooling?: ProjectDiscoveredTooling;
  projectName?: string;
  onResolveUserServers: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
  onResolveProjectServers: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
  onClose: () => void;
}

/* ── Modal ─────────────────────────────────────────────────── */

export function DiscoveredToolingModal({
  userDiscoveredTooling,
  projectDiscoveredTooling,
  projectName,
  onResolveUserServers,
  onResolveProjectServers,
  onClose,
}: DiscoveredToolingModalProps) {
  const pendingUserServers = useMemo(
    () => listPendingDiscoveredMcpServers(userDiscoveredTooling),
    [userDiscoveredTooling],
  );
  const pendingProjectServers = useMemo(
    () => listPendingDiscoveredMcpServers(projectDiscoveredTooling),
    [projectDiscoveredTooling],
  );

  const totalPending = pendingUserServers.length + pendingProjectServers.length;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-close when nothing left to review
  useEffect(() => {
    if (totalPending === 0) onClose();
  }, [totalPending, onClose]);

  if (totalPending === 0) return null;

  const userGroups = groupBySource(pendingUserServers);
  const projectGroups = groupBySource(pendingProjectServers);

  function handleAcceptAll() {
    if (pendingUserServers.length > 0) {
      onResolveUserServers(pendingUserServers.map((s) => s.id), 'accept');
    }
    if (pendingProjectServers.length > 0) {
      onResolveProjectServers(pendingProjectServers.map((s) => s.id), 'accept');
    }
  }

  function handleDismissAll() {
    if (pendingUserServers.length > 0) {
      onResolveUserServers(pendingUserServers.map((s) => s.id), 'dismiss');
    }
    if (pendingProjectServers.length > 0) {
      onResolveProjectServers(pendingProjectServers.map((s) => s.id), 'dismiss');
    }
  }

  return (
    <div
      aria-labelledby="discovered-tooling-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#07080e]/90 backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-[0_16px_64px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileSearch className="size-4 text-[var(--color-text-accent)]" />
            <h2 id="discovered-tooling-title" className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">
              MCP servers found in config files
            </h2>
          </div>
          <button
            className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            The following MCP servers were found in your config files. Accept the ones you want to
            use, or dismiss those you don&apos;t need. Accepted servers become available for session tooling.
          </p>

          {pendingUserServers.length > 0 && (
            <DiscoveredGroup
              groups={userGroups}
              onResolve={onResolveUserServers}
              scopeLabel="User-level"
            />
          )}

          {pendingProjectServers.length > 0 && (
            <DiscoveredGroup
              groups={projectGroups}
              onResolve={onResolveProjectServers}
              scopeLabel={projectName ? `Project: ${projectName}` : 'Project-level'}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-3">
          <span className="text-[12px] text-[var(--color-text-muted)]">
            {totalPending} server{totalPending === 1 ? '' : 's'} pending review
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
              onClick={handleDismissAll}
              type="button"
            >
              Dismiss All
            </button>
            <button
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[var(--color-accent-sky)]"
              onClick={handleAcceptAll}
              type="button"
            >
              Accept All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Discovered group (by scope) ──────────────────────────── */

function DiscoveredGroup({
  scopeLabel,
  groups,
  onResolve,
}: {
  scopeLabel: string;
  groups: SourceGroup[];
  onResolve: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {scopeLabel}
      </div>
      {groups.map((group) => (
        <div className="mb-3" key={group.sourceLabel}>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="truncate font-medium">{group.sourceLabel}</span>
            <span className="text-[var(--color-text-muted)]">·</span>
            <span className="text-[var(--color-text-muted)]">
              {group.servers.length} server{group.servers.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-1">
            {group.servers.map((server) => (
              <ServerRow
                key={server.id}
                onAccept={() => onResolve([server.id], 'accept')}
                onDismiss={() => onResolve([server.id], 'dismiss')}
                server={server}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Server row ────────────────────────────────────────────── */

function ServerRow({
  server,
  onAccept,
  onDismiss,
}: {
  server: DiscoveredMcpServer;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const detail =
    server.transport === 'local'
      ? server.command || 'No command'
      : server.url || 'No URL';

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-glass)] px-3 py-2.5">
      <Server className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {server.name}
          </span>
          <span className="rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {server.transport}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{detail}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
          onClick={onDismiss}
          title="Dismiss"
          type="button"
        >
          <XCircle className="size-3.5" />
        </button>
        <button
          className="flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition hover:bg-[var(--color-status-success)]/10 hover:text-[var(--color-status-success)]"
          onClick={onAccept}
          title="Accept"
          type="button"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */

interface SourceGroup {
  sourceLabel: string;
  servers: DiscoveredMcpServer[];
}

function groupBySource(servers: DiscoveredMcpServer[]): SourceGroup[] {
  const map = new Map<string, DiscoveredMcpServer[]>();
  for (const server of servers) {
    const group = map.get(server.sourceLabel) ?? [];
    group.push(server);
    map.set(server.sourceLabel, group);
  }

  return [...map.entries()]
    .map(([sourceLabel, groupServers]) => ({ sourceLabel, servers: groupServers }))
    .sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel));
}
