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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileSearch className="size-4 text-indigo-400" />
            <h2 id="discovered-tooling-title" className="text-[13px] font-semibold text-zinc-100">
              MCP servers found in config files
            </h2>
          </div>
          <button
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-[12px] leading-relaxed text-zinc-500">
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
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <span className="text-[12px] text-zinc-600">
            {totalPending} server{totalPending === 1 ? '' : 's'} pending review
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              onClick={handleDismissAll}
              type="button"
            >
              Dismiss All
            </button>
            <button
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-indigo-500"
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
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        {scopeLabel}
      </div>
      {groups.map((group) => (
        <div className="mb-3" key={group.sourceLabel}>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="truncate font-medium">{group.sourceLabel}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-600">
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
    <div className="group flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-800/20 px-3 py-2.5">
      <Server className="size-3.5 shrink-0 text-zinc-600" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-200">
            {server.name}
          </span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {server.transport}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-zinc-500">{detail}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="flex size-7 items-center justify-center rounded-md text-zinc-600 transition hover:bg-red-500/10 hover:text-red-400"
          onClick={onDismiss}
          title="Dismiss"
          type="button"
        >
          <XCircle className="size-3.5" />
        </button>
        <button
          className="flex size-7 items-center justify-center rounded-md text-zinc-600 transition hover:bg-emerald-500/10 hover:text-emerald-400"
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
