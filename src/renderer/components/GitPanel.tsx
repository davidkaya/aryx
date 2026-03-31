import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  FileCode2,
  FileMinus2,
  FilePlus2,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

import { getElectronApi } from '@renderer/lib/electronApi';
import type {
  ProjectGitBranchSummary,
  ProjectGitCommitLogEntry,
  ProjectGitDetails,
  ProjectGitDiffPreview,
  ProjectGitWorkingTreeFile,
} from '@shared/domain/project';

/* ── Helpers ───────────────────────────────────────────────── */

function fileBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function fileDir(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.slice(0, lastSlash + 1) : '';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ── Section header ────────────────────────────────────────── */

function SectionHeader({
  icon,
  label,
  count,
  expanded,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors duration-100 hover:bg-[var(--color-surface-2)]/30"
      onClick={onToggle}
      type="button"
      aria-expanded={expanded}
    >
      {expanded
        ? <ChevronDown className="size-2.5 text-[var(--color-text-muted)]" />
        : <ChevronRight className="size-2.5 text-[var(--color-text-muted)]" />}
      {icon}
      <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </span>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[8px] font-semibold tabular-nums text-[var(--color-text-muted)]">
          {count}
        </span>
      )}
    </button>
  );
}

/* ── File status icon ──────────────────────────────────────── */

function fileIcon(file: ProjectGitWorkingTreeFile) {
  if (file.stagedStatus === 'added' || file.unstagedStatus === 'untracked') {
    return <FilePlus2 className="size-3 shrink-0 text-[var(--color-status-success)]" />;
  }
  if (file.stagedStatus === 'deleted' || file.unstagedStatus === 'deleted') {
    return <FileMinus2 className="size-3 shrink-0 text-[var(--color-status-error)]" />;
  }
  return <FileCode2 className="size-3 shrink-0 text-[var(--color-accent-sky)]" />;
}

/* ── Changed file row ──────────────────────────────────────── */

function ChangedFileEntry({
  file,
  projectId,
}: {
  file: ProjectGitWorkingTreeFile;
  projectId: string;
}) {
  const api = getElectronApi();
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<ProjectGitDiffPreview>();

  const dir = fileDir(file.path);
  const base = fileBaseName(file.path);
  const status = file.stagedStatus ?? file.unstagedStatus ?? 'modified';

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!preview) {
      try {
        const result = await api.getProjectGitFilePreview({
          projectId,
          file: { path: file.path, previousPath: file.previousPath },
        });
        if (result) setPreview(result);
      } catch {
        // Preview is best-effort
      }
    }
  }, [api, expanded, file.path, file.previousPath, preview, projectId]);

  return (
    <div className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <button
        className="flex w-full items-center gap-1.5 px-3 py-[5px] text-left text-[10px] transition-colors duration-150 hover:bg-[var(--color-surface-2)]/40"
        onClick={() => void handleToggle()}
        type="button"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`size-2 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        {fileIcon(file)}
        <span className="min-w-0 flex-1 truncate font-mono">
          {dir && <span className="text-[var(--color-text-muted)]">{dir}</span>}
          <span className="text-[var(--color-text-primary)]">{base}</span>
        </span>
        <span className="shrink-0 rounded px-1 py-px text-[7px] font-semibold uppercase tracking-wider bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">
          {status}
        </span>
      </button>

      {expanded && preview && (
        <div className="border-t border-[var(--color-border-subtle)]">
          <pre className="max-h-40 overflow-auto bg-[var(--color-surface-0)] px-3 py-1 font-mono text-[9px] leading-relaxed">
            {preview.diff
              ? preview.diff.split('\n').map((line, i) => {
                  let cls = 'text-[var(--color-text-secondary)]';
                  if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-[var(--color-status-success)]';
                  else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-[var(--color-status-error)]';
                  else if (line.startsWith('@@')) cls = 'text-[var(--color-accent-sky)]';
                  return <div key={i} className={cls}>{line || '\u00A0'}</div>;
                })
              : preview.newFileContents
                ? preview.newFileContents.split('\n').map((line, i) => (
                    <div key={i} className="text-[var(--color-text-secondary)]">{line || '\u00A0'}</div>
                  ))
                : <div className="text-[var(--color-text-muted)] italic">Binary file</div>}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Branch row ────────────────────────────────────────────── */

function BranchRow({
  branch,
  onSwitch,
  onDelete,
  isSwitching,
}: {
  branch: ProjectGitBranchSummary;
  onSwitch: () => void;
  onDelete: () => void;
  isSwitching: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-[5px] text-[10px]">
      <GitBranch className={`size-3 shrink-0 ${branch.isCurrent ? 'text-[var(--color-status-success)]' : 'text-[var(--color-text-muted)]'}`} />
      <span className={`min-w-0 flex-1 truncate font-mono ${branch.isCurrent ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
        {branch.name}
      </span>
      {branch.isCurrent && (
        <span className="rounded px-1 py-px text-[7px] font-semibold uppercase tracking-wider bg-[var(--color-status-success)]/10 text-[var(--color-status-success)]">
          current
        </span>
      )}
      {!branch.isCurrent && (
        <>
          <button
            className="rounded p-0.5 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
            onClick={onSwitch}
            type="button"
            title={`Switch to ${branch.name}`}
            disabled={isSwitching}
          >
            {isSwitching ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
          </button>
          <button
            className="rounded p-0.5 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
            onClick={onDelete}
            type="button"
            title={`Delete ${branch.name}`}
          >
            <Trash2 className="size-2.5" />
          </button>
        </>
      )}
    </div>
  );
}

/* ── Commit log row ────────────────────────────────────────── */

function CommitRow({ commit }: { commit: ProjectGitCommitLogEntry }) {
  return (
    <div className="flex items-start gap-2 px-3 py-[5px] text-[10px]">
      <GitCommitHorizontal className="mt-0.5 size-3 shrink-0 text-[var(--color-text-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[var(--color-text-secondary)]">
          {commit.subject}
        </p>
        <p className="flex items-center gap-1.5 text-[9px] text-[var(--color-text-muted)]">
          <span className="font-mono">{commit.shortHash}</span>
          <span>·</span>
          <span>{commit.authorName}</span>
          <span>·</span>
          <span>{relativeTime(commit.committedAt)}</span>
        </p>
      </div>
    </div>
  );
}

/* ── Create branch dialog ──────────────────────────────────── */

function CreateBranchForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');

  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--color-border-subtle)] px-3 py-1.5">
      <input
        autoFocus
        className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-0)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            e.preventDefault();
            onSubmit(name.trim());
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Branch name…"
        value={name}
      />
      <button
        className="rounded p-1 text-[var(--color-status-success)] transition-colors duration-100 hover:bg-[var(--color-status-success)]/10 disabled:opacity-40"
        disabled={!name.trim()}
        onClick={() => onSubmit(name.trim())}
        type="button"
      >
        <Check className="size-3" />
      </button>
      <button
        className="rounded p-1 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)]"
        onClick={onCancel}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/* ── Main export ───────────────────────────────────────────── */

interface GitPanelProps {
  projectId: string;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function GitPanel({ projectId, onDirtyChange }: GitPanelProps) {
  const api = getElectronApi();

  const [details, setDetails] = useState<ProjectGitDetails>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showChanges, setShowChanges] = useState(true);
  const [showBranches, setShowBranches] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [networkBusy, setNetworkBusy] = useState<'push' | 'pull' | 'fetch'>();

  const loadDetails = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const result = await api.getProjectGitDetails({ projectId });
      setDetails(result);
      setOperationError(undefined);
      onDirtyChange?.(result.context.isDirty ?? false);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const ctx = details?.context;
  const workingTree = details?.workingTree;
  const branches = details?.branches ?? [];
  const commits = details?.recentCommits ?? [];
  const changedFiles = workingTree?.files ?? [];

  const handlePush = useCallback(async () => {
    setNetworkBusy('push');
    setOperationError(undefined);
    try {
      await api.pushProjectGit({ projectId });
      await loadDetails(true);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetworkBusy(undefined);
    }
  }, [api, loadDetails, projectId]);

  const handlePull = useCallback(async () => {
    setNetworkBusy('pull');
    setOperationError(undefined);
    try {
      await api.pullProjectGit({ projectId });
      await loadDetails(true);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetworkBusy(undefined);
    }
  }, [api, loadDetails, projectId]);

  const handleFetch = useCallback(async () => {
    setNetworkBusy('fetch');
    setOperationError(undefined);
    try {
      await api.fetchProjectGit({ projectId });
      await loadDetails(true);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetworkBusy(undefined);
    }
  }, [api, loadDetails, projectId]);

  const handleSwitchBranch = useCallback(async (name: string) => {
    setSwitchingBranch(name);
    setOperationError(undefined);
    try {
      await api.switchProjectGitBranch({ projectId, name });
      await loadDetails(true);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitchingBranch(undefined);
    }
  }, [api, loadDetails, projectId]);

  const handleDeleteBranch = useCallback(async (name: string) => {
    setOperationError(undefined);
    try {
      await api.deleteProjectGitBranch({ projectId, name });
      await loadDetails(true);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  }, [api, loadDetails, projectId]);

  const handleCreateBranch = useCallback(async (name: string) => {
    setShowCreateBranch(false);
    setOperationError(undefined);
    try {
      await api.createProjectGitBranch({ projectId, name, checkout: true });
      await loadDetails(true);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  }, [api, loadDetails, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-[var(--color-text-muted)]" aria-label="Loading git status" />
      </div>
    );
  }

  if (!ctx || ctx.status !== 'ready') {
    return (
      <div className="px-3 py-4 text-center text-[11px] text-[var(--color-text-muted)]">
        {ctx?.status === 'not-repository'
          ? 'Not a git repository'
          : ctx?.status === 'git-missing'
            ? 'Git is not installed'
            : ctx?.errorMessage ?? 'Unable to read git status'}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Branch header + network actions */}
      <div className="border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <GitBranch className="size-3 text-[var(--color-accent-sky)]" />
          <span className="font-mono text-[11px] font-medium text-[var(--color-text-primary)]">
            {ctx.branch ?? 'detached HEAD'}
          </span>

          {ctx.upstream && (
            <span className="text-[9px] text-[var(--color-text-muted)]">
              {ctx.ahead !== undefined && ctx.ahead > 0 && <span className="text-[var(--color-status-success)]">↑{ctx.ahead}</span>}
              {ctx.behind !== undefined && ctx.behind > 0 && <span className="ml-0.5 text-[var(--color-status-warning)]">↓{ctx.behind}</span>}
            </span>
          )}

          <div className="flex-1" />

          {/* Network buttons */}
          <button
            className="rounded p-1 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)] disabled:opacity-40"
            disabled={!!networkBusy}
            onClick={() => void handleFetch()}
            title="Fetch"
            type="button"
          >
            {networkBusy === 'fetch' ? <Loader2 className="size-3 animate-spin" /> : <Cloud className="size-3" />}
          </button>
          <button
            className="rounded p-1 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)] disabled:opacity-40"
            disabled={!!networkBusy}
            onClick={() => void handlePull()}
            title="Pull"
            type="button"
          >
            {networkBusy === 'pull' ? <Loader2 className="size-3 animate-spin" /> : <ArrowDownToLine className="size-3" />}
          </button>
          <button
            className="rounded p-1 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)] disabled:opacity-40"
            disabled={!!networkBusy}
            onClick={() => void handlePush()}
            title="Push"
            type="button"
          >
            {networkBusy === 'push' ? <Loader2 className="size-3 animate-spin" /> : <ArrowUpFromLine className="size-3" />}
          </button>
          <button
            className="rounded p-1 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
            onClick={() => void loadDetails(true)}
            title="Refresh"
            type="button"
          >
            <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {ctx.isDirty && (
          <div className="mt-1 text-[9px] text-[var(--color-status-warning)]">
            {ctx.changedFileCount} uncommitted {ctx.changedFileCount === 1 ? 'change' : 'changes'}
          </div>
        )}
      </div>

      {/* Error */}
      {operationError && (
        <div className="flex items-start gap-1.5 border-b border-[var(--color-status-error)]/20 bg-[var(--color-status-error)]/5 px-3 py-1.5 text-[9px] text-[var(--color-status-error)]" role="alert">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 flex-1">{operationError}</span>
          <button
            className="shrink-0 rounded p-0.5 transition-colors duration-100 hover:bg-[var(--color-status-error)]/10"
            onClick={() => setOperationError(undefined)}
            type="button"
            aria-label="Dismiss error"
          >
            <X className="size-2.5" />
          </button>
        </div>
      )}

      {/* Changed files */}
      <SectionHeader
        count={changedFiles.length}
        expanded={showChanges}
        icon={<FileCode2 className="size-3 text-[var(--color-accent-sky)]" />}
        label="Changes"
        onToggle={() => setShowChanges(!showChanges)}
      />
      {showChanges && (
        <div>
          {changedFiles.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-[var(--color-text-muted)]">Working tree clean</p>
          ) : (
            changedFiles.map((file) => (
              <ChangedFileEntry
                file={file}
                key={file.path}
                projectId={projectId}
              />
            ))
          )}
        </div>
      )}

      {/* Branches */}
      <SectionHeader
        count={branches.length}
        expanded={showBranches}
        icon={<GitBranch className="size-3 text-[var(--color-status-success)]" />}
        label="Branches"
        onToggle={() => setShowBranches(!showBranches)}
      />
      {showBranches && (
        <div>
          {/* New branch button */}
          {!showCreateBranch && (
            <button
              className="flex w-full items-center gap-1.5 px-3 py-[5px] text-[10px] text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-2)]/40 hover:text-[var(--color-text-accent)]"
              onClick={() => setShowCreateBranch(true)}
              type="button"
            >
              <Plus className="size-3" />
              New branch
            </button>
          )}

          {showCreateBranch && (
            <CreateBranchForm
              onCancel={() => setShowCreateBranch(false)}
              onSubmit={(name) => void handleCreateBranch(name)}
            />
          )}

          {branches.map((branch) => (
            <BranchRow
              branch={branch}
              isSwitching={switchingBranch === branch.name}
              key={branch.name}
              onDelete={() => void handleDeleteBranch(branch.name)}
              onSwitch={() => void handleSwitchBranch(branch.name)}
            />
          ))}
        </div>
      )}

      {/* Commit history */}
      <SectionHeader
        count={commits.length}
        expanded={showHistory}
        icon={<History className="size-3 text-[var(--color-text-muted)]" />}
        label="Recent Commits"
        onToggle={() => setShowHistory(!showHistory)}
      />
      {showHistory && (
        <div>
          {commits.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-[var(--color-text-muted)]">No commit history</p>
          ) : (
            commits.map((commit) => (
              <CommitRow commit={commit} key={commit.hash} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
