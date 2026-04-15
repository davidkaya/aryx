import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import appIconUrl from '../../../assets/icons/icon.png';
import { isMac } from '@renderer/lib/platform';
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  FolderOpen,
  GitBranch,
  GitFork,
  ListOrdered,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { resolveWorkflowAgentNodes, type WorkflowDefinition, type WorkflowOrchestrationMode } from '@shared/domain/workflow';
import { isScratchpadProject, type ProjectRecord, type ProjectGitContext } from '@shared/domain/project';
import { listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { SessionRecord } from '@shared/domain/session';
import { querySessions } from '@shared/domain/sessionLibrary';
import type { UpdateStatus } from '@shared/contracts/ipc';
import type { WorkspaceState } from '@shared/domain/workspace';
import { UpdateBanner } from '@renderer/components/ui';
import { useSessionSelection } from '@renderer/hooks/useSessionSelection';
import { BatchActionBar } from '@renderer/components/sidebar/BatchActionBar';
import { BatchDeleteConfirmDialog } from '@renderer/components/sidebar/BatchDeleteConfirmDialog';
import { UndoToast } from '@renderer/components/sidebar/UndoToast';

interface SidebarProps {
  workspace: WorkspaceState;
  onAddProject: () => void;
  onCreateScratchpad: () => void;
  onNewProjectSession: (projectId: string) => void;
  onProjectSelect: (projectId?: string) => void;
  onSessionSelect: (sessionId: string) => void;
  onOpenSettings: () => void;
  onOpenProjectSettings: (projectId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onSetSessionPinned: (sessionId: string, isPinned: boolean) => void;
  onSetSessionArchived: (sessionId: string, isArchived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onBatchArchiveSessions: (sessionIds: string[], isArchived: boolean) => void;
  onBatchDeleteSessions: (sessionIds: string[]) => void;
  onRefreshGitContext: (projectId: string) => void;
  updateStatus?: UpdateStatus;
  onViewUpdateDetails?: () => void;
  onInstallUpdate?: () => void;
}

/* ── Mode icon + accent colour mapping ─────────────────────── */

const modeVisuals: Record<WorkflowOrchestrationMode, { icon: LucideIcon; color: string }> = {
  single: { icon: MessageSquare, color: 'text-[#245CF9]' },
  sequential: { icon: ListOrdered, color: 'text-[var(--color-status-warning)]' },
  concurrent: { icon: GitFork, color: 'text-[var(--color-status-success)]' },
  handoff: { icon: ArrowLeftRight, color: 'text-[var(--color-accent-sky)]' },
  'group-chat': { icon: Users, color: 'text-[var(--color-accent-purple)]' },
};

/* ── Relative time helper ──────────────────────────────────── */

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

/* ── Git context badge ──────────────────────────────────────── */

function GitContextBadge({ git }: { git: ProjectGitContext }) {
  if (git.status === 'not-repository') {
    return (
      <span className="text-[10px] text-[var(--color-text-muted)]" title="Not a git repository">
        no repo
      </span>
    );
  }

  if (git.status === 'git-missing') {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-amber-500/70" title="Git is not installed">
        <AlertTriangle className="size-2.5" />
        no git
      </span>
    );
  }

  if (git.status === 'error') {
    return (
      <span
        className="flex items-center gap-0.5 text-[10px] text-red-400/70"
        title={git.errorMessage ?? 'Git error'}
      >
        <AlertTriangle className="size-2.5" />
        error
      </span>
    );
  }

  const branchLabel = git.branch ?? git.head?.shortHash ?? 'HEAD';
  const parts: string[] = [];
  if (git.isDirty && git.changedFileCount) parts.push(`${git.changedFileCount} changed`);
  if (git.ahead) parts.push(`↑${git.ahead}`);
  if (git.behind) parts.push(`↓${git.behind}`);

  const tooltipLines: string[] = [branchLabel];
  if (git.changes) {
    const breakdown: string[] = [];
    if (git.changes.staged > 0) breakdown.push(`${git.changes.staged} staged`);
    if (git.changes.unstaged > 0) breakdown.push(`${git.changes.unstaged} modified`);
    if (git.changes.untracked > 0) breakdown.push(`${git.changes.untracked} untracked`);
    if (git.changes.conflicted > 0) breakdown.push(`${git.changes.conflicted} conflicted`);
    if (breakdown.length > 0) tooltipLines.push(breakdown.join(', '));
  }
  if (git.ahead || git.behind) {
    const sync: string[] = [];
    if (git.ahead) sync.push(`${git.ahead} ahead`);
    if (git.behind) sync.push(`${git.behind} behind`);
    tooltipLines.push(sync.join(', '));
  }
  if (git.upstream) tooltipLines.push(`→ ${git.upstream}`);

  return (
    <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]" title={tooltipLines.join('\n')}>
      <GitBranch className="size-2.5 shrink-0" />
      <span className="max-w-[140px] truncate font-mono">{branchLabel}</span>
      {git.isDirty && <Circle className="size-1.5 shrink-0 fill-amber-500 text-amber-500" />}
    </span>
  );
}

/* ── Context menu item ─────────────────────────────────────── */

function ActionMenuItem({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[12px] transition-all duration-150 hover:bg-[var(--color-surface-2)] ${className ?? 'text-[var(--color-text-primary)]'}`}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

/* ── Session item ──────────────────────────────────────────── */

function SessionItem({
  session,
  workflow,
  isActive,
  isRenaming,
  onSelect,
  onOpenMenu,
  onRenameSubmit,
  onRenameCancel,
  isSelecting,
  isSelected,
  selectionIndex,
  onToggleSelection,
}: {
  session: SessionRecord;
  workflow?: WorkflowDefinition;
  isActive: boolean;
  isRenaming: boolean;
  onSelect: () => void;
  onOpenMenu: (e: React.MouseEvent) => void;
  onRenameSubmit: (title: string) => void;
  onRenameCancel: () => void;
  isSelecting?: boolean;
  isSelected?: boolean;
  selectionIndex?: number;
  onToggleSelection?: () => void;
}) {
  const isRunning = session.status === 'running';
  const isError = session.status === 'error';
  const hasPendingApproval = session.pendingApproval?.status === 'pending';
  const queuedCount = (session.pendingApprovalQueue ?? []).filter((a) => a.status === 'pending').length;
  const mode = workflow?.settings.orchestrationMode ?? 'single';
  const visual = modeVisuals[mode];
  const ModeIcon = visual.icon;
  const agentCount = workflow ? resolveWorkflowAgentNodes(workflow).length : 1;
  const isSelectDisabled = isRunning && isSelecting;

  const [renameText, setRenameText] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setRenameText(session.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isRenaming, session.title]);

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = renameText.trim();
      if (trimmed) onRenameSubmit(trimmed);
      else onRenameCancel();
    } else if (e.key === 'Escape') {
      onRenameCancel();
    }
  }

  function handleRenameBlur() {
    const trimmed = renameText.trim();
    if (trimmed && trimmed !== session.title) onRenameSubmit(trimmed);
    else onRenameCancel();
  }

  function handleClick(e: React.MouseEvent) {
    if (isRenaming) return;
    if (isSelecting) {
      if (!isSelectDisabled) onToggleSelection?.();
      return;
    }
    onSelect();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ' ') && !isRenaming) {
      e.preventDefault();
      if (isSelecting) {
        if (!isSelectDisabled) onToggleSelection?.();
      } else {
        onSelect();
      }
    }
  }

  return (
    <div
      className={`session-item-enter group relative flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-200 ${
        isSelecting && isSelected
          ? 'bg-[var(--color-accent-muted)] ring-1 ring-[var(--color-border-glow)]'
          : isActive && !isSelecting
            ? 'bg-[var(--color-accent-muted)] ring-1 ring-[var(--color-border-glow)]'
            : 'hover:bg-[var(--color-surface-2)]/60'
      } ${isRunning ? 'sidebar-running' : ''} ${session.isArchived ? 'opacity-50' : ''} ${isSelectDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
      onClick={handleClick}
      role={isSelecting ? 'checkbox' : 'button'}
      aria-checked={isSelecting ? isSelected : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Running/approval left accent bar */}
      {isRunning && !hasPendingApproval && !isSelecting && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full accent-flow" />
      )}
      {hasPendingApproval && !isSelecting && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[var(--color-status-warning)]" />
      )}
      {/* Selection accent bar */}
      {isSelecting && isSelected && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[var(--color-accent)]" />
      )}

      {/* Mode icon or selection checkbox */}
      {isSelecting ? (
        <span
          className="selection-checkbox-enter mt-0.5 flex size-6 shrink-0 items-center justify-center"
          style={{ animationDelay: `${(selectionIndex ?? 0) * 30}ms` }}
          title={isSelectDisabled ? "Can't select running sessions" : undefined}
        >
          <span
            className={`flex size-4 items-center justify-center rounded border transition-all duration-150 ${
              isSelected
                ? 'checkbox-check border-[var(--color-accent)] bg-[var(--color-accent)]'
                : isSelectDisabled
                  ? 'border-[var(--color-text-muted)]/30 bg-transparent'
                  : 'border-[var(--color-text-muted)]/50 bg-transparent hover:border-[var(--color-accent)]/50'
            }`}
          >
            {isSelected && <Check className="size-3 text-white" strokeWidth={3} />}
          </span>
        </span>
      ) : (
        <span
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ${
            isActive ? 'bg-[var(--color-accent-muted)]' : 'bg-[var(--color-surface-2)]'
          }`}
        >
          <ModeIcon className={`size-3.5 ${isActive ? 'text-[var(--color-accent)]' : visual.color}`} />
        </span>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {session.isPinned && <Pin className="size-3 shrink-0 text-amber-500/70" />}
          {isRenaming ? (
            <input
              ref={inputRef}
              className="w-full rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[13px] font-medium text-[var(--color-text-primary)] outline-none ring-1 ring-[var(--color-border-glow)]"
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className={`truncate text-[13px] font-medium leading-tight ${
                isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-primary)] group-hover:text-[var(--color-text-primary)]'
              }`}
            >
              {session.title}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2">
          {agentCount > 1 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-muted)]">
              <Users className="size-2.5" />
              {agentCount}
            </span>
          )}
          {isRunning && !hasPendingApproval && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-accent-sky)]">
              <span className="size-1.5 rounded-full bg-[var(--color-accent-sky)] sidebar-pulse" />
              Running
            </span>
          )}
          {hasPendingApproval && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-status-warning)]">
              <span className="size-1.5 rounded-full bg-[var(--color-status-warning)] animate-pulse" />
              Awaiting approval{queuedCount > 0 && ` (+${queuedCount})`}
            </span>
          )}
          {isError && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-status-error)]">
              <span className="size-1.5 rounded-full bg-[var(--color-status-error)]" />
              Error
            </span>
          )}
          {session.isArchived && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
              <Archive className="size-2.5" />
              Archived
            </span>
          )}
          {session.branchOrigin && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-muted)]"
              title={
                session.branchOrigin.action === 'regenerate'
                  ? 'Regenerated response'
                  : session.branchOrigin.action === 'edit-and-resend'
                    ? 'Edited & resent'
                    : 'Branched session'
              }
            >
              {session.branchOrigin.action === 'regenerate'
                ? <RefreshCw className="size-2.5" />
                : session.branchOrigin.action === 'edit-and-resend'
                  ? <Pencil className="size-2.5" />
                  : <GitBranch className="size-2.5" />
              }
            </span>
          )}
          <span className="ml-auto text-[10px] text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]">
            {relativeTime(session.updatedAt)}
          </span>
        </div>
      </div>

      {/* Actions button (hidden during rename and selection mode) */}
      {!isRenaming && !isSelecting && (
        <button
          className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-[var(--color-text-muted)] opacity-0 transition-all duration-150 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onOpenMenu(e); }}
          type="button"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* ── Project group ─────────────────────────────────────────── */

function ProjectGroup({
  project,
  sessions,
  workflows,
  selectedSessionId,
  renamingSessionId,
  onSessionSelect,
  onOpenMenu,
  onRenameSubmit,
  onRenameCancel,
  onRefreshGitContext,
  onOpenProjectSettings,
  onNewSession,
  newSessionLabel,
  isSelecting,
  isSelected,
  onToggleSelection,
}: {
  project: ProjectRecord;
  sessions: SessionRecord[];
  workflows: WorkflowDefinition[];
  selectedSessionId?: string;
  renamingSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onOpenMenu: (sessionId: string, e: React.MouseEvent) => void;
  onRenameSubmit: (sessionId: string, title: string) => void;
  onRenameCancel: () => void;
  onRefreshGitContext?: (projectId: string) => void;
  onOpenProjectSettings?: (projectId: string) => void;
  onNewSession?: () => void;
  newSessionLabel?: string;
  isSelecting?: boolean;
  isSelected?: (sessionId: string) => boolean;
  onToggleSelection?: (sessionId: string) => void;
}){
  const [expanded, setExpanded] = useState(true);
  const isScratchpad = isScratchpadProject(project);

  const workflowMap = useMemo(() => {
    const map = new Map<string, WorkflowDefinition>();
    for (const w of workflows) map.set(w.id, w);
    return map;
  }, [workflows]);

  const visibleSessions = useMemo(() =>
    sessions
      .filter((s) => !s.isArchived)
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return 0;
      }),
    [sessions],
  );

  const runningCount = visibleSessions.filter((s) => s.status === 'running').length;
  const pendingDiscoveryCount = useMemo(
    () => isScratchpad ? 0 : listPendingDiscoveredMcpServers(project.discoveredTooling).length,
    [isScratchpad, project.discoveredTooling],
  );

  return (
    <div>
      <button
        className="group flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-all duration-150 hover:bg-[var(--color-surface-2)]/40"
        onClick={() => setExpanded(!expanded)}
        type="button"
        title={`${project.name}\n${project.path}`}
      >
        {/* Row 1 — project identity + hover actions */}
        <div className="flex w-full items-center gap-2 text-[13px] font-semibold text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]">
          {expanded ? (
            <ChevronDown className="size-3 shrink-0 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-[var(--color-text-muted)]" />
          )}
          {isScratchpad ? (
            <MessageSquare className="size-3.5 shrink-0 text-[var(--color-text-muted)] transition group-hover:text-[var(--color-accent)]" />
          ) : (
            <FolderOpen className="size-3.5 shrink-0 text-[var(--color-text-muted)] transition group-hover:text-[var(--color-accent)]" />
          )}
          <span className="min-w-0 flex-1 truncate">{project.name}</span>

          {isScratchpad && (
            <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
              {visibleSessions.length}
            </span>
          )}

          {!isScratchpad && (onOpenProjectSettings || onRefreshGitContext) && (
            <div className="flex shrink-0 items-center gap-0.5">
              {onOpenProjectSettings && (
                <span
                  className="flex size-5 items-center justify-center rounded text-[var(--color-text-muted)] opacity-0 transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenProjectSettings(project.id);
                  }}
                  role="button"
                  title="Project settings"
                >
                  <Settings className="size-3" />
                </span>
              )}
              {onRefreshGitContext && (
                <span
                  className="flex size-5 items-center justify-center rounded text-[var(--color-text-muted)] opacity-0 transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshGitContext(project.id);
                  }}
                  role="button"
                  title="Refresh git status"
                >
                  <RefreshCw className="size-3" />
                </span>
              )}
            </div>
          )}
        </div>

        {/* Row 2 — metadata strip: branch, status badges, session count */}
        {!isScratchpad && (project.git || runningCount > 0 || pendingDiscoveryCount > 0 || visibleSessions.length > 0) && (
          <div className="ml-[26px] flex items-center gap-2">
            {project.git && <GitContextBadge git={project.git} />}

            {runningCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-[var(--color-accent-sky)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent-sky)]">
                <span className="size-1.5 rounded-full bg-[var(--color-accent-sky)] sidebar-pulse" />
                {runningCount}
              </span>
            )}
            {pendingDiscoveryCount > 0 && (
              <span
                className="flex cursor-pointer items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 transition hover:bg-amber-500/20"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProjectSettings?.(project.id);
                }}
                role="button"
                title={`${pendingDiscoveryCount} MCP server${pendingDiscoveryCount === 1 ? '' : 's'} discovered — click to review`}
              >
                {pendingDiscoveryCount} new
              </span>
            )}
            <span className="ml-auto rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
              {visibleSessions.length}
            </span>
          </div>
        )}

      </button>

      {expanded && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-[var(--color-border-subtle)] pl-2">
          {visibleSessions.length > 0 &&
            visibleSessions.map((session, index) => (
              <SessionItem
                isActive={selectedSessionId === session.id}
                isRenaming={renamingSessionId === session.id}
                key={session.id}
                onSelect={() => onSessionSelect(session.id)}
                onOpenMenu={(e) => onOpenMenu(session.id, e)}
                onRenameSubmit={(title) => onRenameSubmit(session.id, title)}
                onRenameCancel={onRenameCancel}
                 workflow={workflowMap.get(session.workflowId)}
                session={session}
                isSelecting={isSelecting}
                isSelected={isSelected?.(session.id)}
                selectionIndex={index}
                onToggleSelection={() => onToggleSelection?.(session.id)}
              />
            ))}
          {onNewSession ? (
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)]/40 px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:border-[var(--color-border-glow)] hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-accent)]"
              onClick={onNewSession}
              type="button"
            >
              <Plus className="size-3.5" />
              {newSessionLabel ?? 'New Session'}
            </button>
          ) : (
            visibleSessions.length === 0 && (
              <div className="px-3 py-3 text-center text-[12px] text-[var(--color-text-muted)]">
                {isScratchpad ? 'No scratchpad chats yet' : 'No sessions yet'}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sidebar ───────────────────────────────────────────────── */

export function Sidebar({
  workspace,
  onAddProject,
  onCreateScratchpad,
  onNewProjectSession,
  onProjectSelect,
  onSessionSelect,
  onOpenSettings,
  onOpenProjectSettings,
  onRenameSession,
  onDuplicateSession,
  onSetSessionPinned,
  onSetSessionArchived,
  onDeleteSession,
  onBatchArchiveSessions,
  onBatchDeleteSessions,
  onRefreshGitContext,
  updateStatus,
  onViewUpdateDetails,
  onInstallUpdate,
}: SidebarProps) {
  const scratchpadProject = workspace.projects.find((project) => isScratchpadProject(project));
  const userProjects = workspace.projects.filter((project) => !isScratchpadProject(project));

  /* ── Search & filter state ─────────────────────────────────── */

  const [searchText, setSearchText] = useState('');

  const isQueryActive = searchText.trim().length > 0;

  const workflowMap = useMemo(() => {
    const map = new Map<string, WorkflowDefinition>();
    for (const w of workspace.workflows) {
      map.set(w.id, w);
    }
    return map;
  }, [workspace.workflows]);

  const queryResults = useMemo(() => {
    if (!isQueryActive) return [];

    const results = querySessions(workspace, {
      searchText: searchText.trim() || undefined,
    });

    return results
      .map((r) => workspace.sessions.find((s) => s.id === r.sessionId))
      .filter((s): s is SessionRecord => s !== undefined);
  }, [workspace, searchText, isQueryActive]);

  /* ── Context menu state ────────────────────────────────────── */

  const [menuState, setMenuState] = useState<{ sessionId: string; top: number; left: number } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleOpenMenu(sessionId: string, e: React.MouseEvent) {
    if (selection.isSelecting) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuState({
      sessionId,
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - 160),
    });
  }

  function closeMenu() {
    setMenuState(null);
  }

  function handleRenameSubmit(sessionId: string, title: string) {
    setRenamingSessionId(undefined);
    onRenameSession(sessionId, title);
  }

  const menuSession = menuState
    ? workspace.sessions.find((s) => s.id === menuState.sessionId)
    : undefined;

  /* ── Multi-select state ────────────────────────────────────── */

  const selection = useSessionSelection();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [undoToast, setUndoToast] = useState<{ message: string; sessionIds: string[]; isArchived: boolean } | null>(null);

  // All selectable (non-running) session IDs across the visible list
  const allSelectableIds = useMemo(() => {
    const sessions = workspace.sessions.filter((s) => !s.isArchived && s.status !== 'running');
    return sessions.map((s) => s.id);
  }, [workspace.sessions]);

  // All visible session IDs (for range select and "select all")
  const allVisibleIds = useMemo(() => {
    if (isQueryActive) return queryResults.map((s) => s.id);
    return workspace.sessions.filter((s) => !s.isArchived).map((s) => s.id);
  }, [isQueryActive, queryResults, workspace.sessions]);

  const allSelectedArchived = useMemo(() => {
    if (selection.selectedIds.size === 0) return false;
    return [...selection.selectedIds].every((id) => {
      const session = workspace.sessions.find((s) => s.id === id);
      return session?.isArchived;
    });
  }, [selection.selectedIds, workspace.sessions]);

  const selectedSessions = useMemo(
    () => workspace.sessions.filter((s) => selection.selectedIds.has(s.id)),
    [selection.selectedIds, workspace.sessions],
  );

  function handleSessionClick(sessionId: string, e: React.MouseEvent) {
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    const session = workspace.sessions.find((s) => s.id === sessionId);
    const isRunning = session?.status === 'running';

    if (selection.isSelecting) {
      if (isRunning) return;
      if (e.shiftKey) {
        selection.rangeSelect(sessionId, allVisibleIds);
      } else {
        selection.toggle(sessionId);
      }
      return;
    }

    if (modKey && !isRunning) {
      selection.enterSelectionMode(sessionId);
      return;
    }

    onSessionSelect(sessionId);
  }

  function handleToggleSelection(sessionId: string) {
    const session = workspace.sessions.find((s) => s.id === sessionId);
    if (session?.status === 'running') return;
    selection.toggle(sessionId);
  }

  const handleBatchArchive = useCallback(() => {
    const ids = [...selection.selectedIds];
    const isArchived = !allSelectedArchived;
    onBatchArchiveSessions(ids, isArchived);
    selection.exitSelectionMode();
    setUndoToast({
      message: `${ids.length} session${ids.length === 1 ? '' : 's'} ${isArchived ? 'archived' : 'restored'}`,
      sessionIds: ids,
      isArchived,
    });
  }, [selection, allSelectedArchived, onBatchArchiveSessions]);

  const handleBatchDeleteConfirm = useCallback(() => {
    const ids = [...selection.selectedIds];
    onBatchDeleteSessions(ids);
    selection.exitSelectionMode();
    setShowDeleteConfirm(false);
  }, [selection, onBatchDeleteSessions]);

  const handleUndoArchive = useCallback(() => {
    if (!undoToast) return;
    onBatchArchiveSessions(undoToast.sessionIds, !undoToast.isArchived);
    setUndoToast(null);
  }, [undoToast, onBatchArchiveSessions]);

  // Exit selection mode on Escape
  useEffect(() => {
    if (!selection.isSelecting) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        selection.exitSelectionMode();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selection.isSelecting, selection.exitSelectionMode]);

  // Clean up selection when sessions are removed from workspace
  useEffect(() => {
    if (!selection.isSelecting) return;
    const sessionIdSet = new Set(workspace.sessions.map((s) => s.id));
    const stale = [...selection.selectedIds].filter((id) => !sessionIdSet.has(id));
    if (stale.length > 0) {
      for (const id of stale) selection.toggle(id);
    }
  }, [workspace.sessions, selection]);

  return (
    <div className="flex h-full flex-col">
      {/* Header — extra top padding clears the title bar overlay zone */}
      <div className={`drag-region flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3 pt-3 pr-4 ${isMac ? 'pl-20' : 'pl-4'}`}>
        <div className="flex items-center gap-2.5">
          <img alt="aryx" className="size-8 rounded-xl" src={appIconUrl} />
          <div>
            <span className="font-display text-sm font-semibold text-[var(--color-text-primary)]">aryx</span>
            <span className="ml-1.5 rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)]">
              ALPHA
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="no-drag flex size-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
            onClick={onOpenSettings}
            title="Settings"
            type="button"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-2 px-3 pt-3 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-0)]/60 py-1.5 pl-8 pr-8 text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition-all duration-200 focus:border-[var(--color-border-glow)] focus:bg-[var(--color-surface-0)] focus:shadow-[0_0_12px_rgba(36,92,249,0.06)]"
            placeholder="Search sessions…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              onClick={() => setSearchText('')}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div
        className="flex-1 overflow-y-auto px-2 py-2"
        ref={scrollRef}
        onScroll={closeMenu}
      >
        {isQueryActive ? (
          /* ── Flat search / filter results ──────────────────────── */
          <div className="space-y-1">
            <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              Results ({queryResults.length})
            </div>
            {queryResults.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-[var(--color-text-muted)]">
                No sessions match your search
              </div>
            ) : (
              queryResults.map((session, index) => (
                <SessionItem
                  isActive={workspace.selectedSessionId === session.id}
                  isRenaming={renamingSessionId === session.id}
                  key={session.id}
                  onSelect={() => handleSessionClick(session.id, { ctrlKey: false, metaKey: false, shiftKey: false } as React.MouseEvent)}
                  onOpenMenu={(e) => handleOpenMenu(session.id, e)}
                  onRenameSubmit={(title) => handleRenameSubmit(session.id, title)}
                  onRenameCancel={() => setRenamingSessionId(undefined)}
                   workflow={workflowMap.get(session.workflowId)}
                  session={session}
                  isSelecting={selection.isSelecting}
                  isSelected={selection.isSelected(session.id)}
                  selectionIndex={index}
                  onToggleSelection={() => handleToggleSelection(session.id)}
                />
              ))
            )}
          </div>
        ) : (
          /* ── Normal project tree ───────────────────────────────── */
          <div className="space-y-3">
            {scratchpadProject && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  Scratchpad
                </div>
                <ProjectGroup
                  key={scratchpadProject.id}
                  onSessionSelect={onSessionSelect}
                  onOpenMenu={handleOpenMenu}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={() => setRenamingSessionId(undefined)}
                  renamingSessionId={renamingSessionId}
                   workflows={[...workflowMap.values()]}
                  project={scratchpadProject}
                  selectedSessionId={workspace.selectedSessionId}
                  sessions={workspace.sessions.filter((session) => session.projectId === scratchpadProject.id)}
                  onNewSession={onCreateScratchpad}
                  newSessionLabel="New Scratchpad"
                  isSelecting={selection.isSelecting}
                  isSelected={selection.isSelected}
                  onToggleSelection={handleToggleSelection}
                />
              </div>
            )}

            {userProjects.length === 0 ? (
              <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
                <div className="relative">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] ring-1 ring-[var(--color-border)]">
                    <FolderOpen className="size-7 text-[var(--color-text-muted)]" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full brand-gradient-bg ring-2 ring-[var(--color-surface-1)]">
                    <Plus className="size-3 text-white" />
                  </div>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-[var(--color-text-primary)]">No projects yet</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                    Use Scratchpad for ad-hoc chat or add a repo<br />to work against project files
                  </p>
                </div>
                <button
                  className="rounded-lg brand-gradient-bg px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_12px_rgba(36,92,249,0.25)] transition-all duration-200 hover:shadow-[0_4px_20px_rgba(36,92,249,0.35)]"
                  onClick={onAddProject}
                  type="button"
                >
                  Add Project
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  Projects
                </div>
                {userProjects.map((project) => (
                  <ProjectGroup
                    key={project.id}
                    onSessionSelect={onSessionSelect}
                    onOpenMenu={handleOpenMenu}
                    onRenameSubmit={handleRenameSubmit}
                    onRenameCancel={() => setRenamingSessionId(undefined)}
                    onRefreshGitContext={onRefreshGitContext}
                    onOpenProjectSettings={onOpenProjectSettings}
                    renamingSessionId={renamingSessionId}
                     workflows={[...workflowMap.values()]}
                    project={project}
                    selectedSessionId={workspace.selectedSessionId}
                    sessions={workspace.sessions.filter((session) => session.projectId === project.id)}
                    onNewSession={() => onNewProjectSession(project.id)}
                    isSelecting={selection.isSelecting}
                    isSelected={selection.isSelected}
                    onToggleSelection={handleToggleSelection}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Update notification banner */}
      {updateStatus && onViewUpdateDetails && onInstallUpdate && (
        <UpdateBanner
          status={updateStatus}
          onViewDetails={onViewUpdateDetails}
          onInstallUpdate={onInstallUpdate}
        />
      )}

      {/* Footer */}
      {userProjects.length > 0 && (
        <div className="border-t border-[var(--color-border-subtle)] px-3 py-2">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text-primary)]"
            onClick={onAddProject}
            type="button"
          >
            <FolderOpen className="size-3.5" />
            Add another project
          </button>
        </div>
      )}

      {/* Context menu overlay */}
      {menuState && menuSession && !selection.isSelecting && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} onKeyDown={(e) => { if (e.key === 'Escape') closeMenu(); }} />
          <div
            className="fixed z-50 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] py-1 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
            role="menu"
            style={{ top: menuState.top, left: menuState.left }}
          >
            <ActionMenuItem
              icon={Pencil}
              label="Rename"
              onClick={() => {
                setRenamingSessionId(menuState.sessionId);
                closeMenu();
              }}
            />
            <ActionMenuItem
              icon={Copy}
              label="Duplicate"
              onClick={() => {
                onDuplicateSession(menuState.sessionId);
                closeMenu();
              }}
            />
            <ActionMenuItem
              icon={Pin}
              label={menuSession.isPinned ? 'Unpin' : 'Pin'}
              onClick={() => {
                onSetSessionPinned(menuState.sessionId, !menuSession.isPinned);
                closeMenu();
              }}
            />
            <ActionMenuItem
              icon={Archive}
              label={menuSession.isArchived ? 'Restore' : 'Archive'}
              onClick={() => {
                onSetSessionArchived(menuState.sessionId, !menuSession.isArchived);
                closeMenu();
              }}
            />
            <ActionMenuItem
              className="text-[var(--color-status-error)] hover:bg-[var(--color-status-error)]/10"
              icon={Trash2}
              label="Delete"
              onClick={() => {
                onDeleteSession(menuState.sessionId);
                closeMenu();
              }}
            />
          </div>
        </>
      )}

      {/* Batch action bar */}
      {selection.isSelecting && selection.selectedIds.size > 0 && (
        <BatchActionBar
          selectedCount={selection.selectedIds.size}
          allSelectedArchived={allSelectedArchived}
          allSelected={allSelectableIds.length > 0 && allSelectableIds.every((id) => selection.selectedIds.has(id))}
          onArchive={handleBatchArchive}
          onDelete={() => setShowDeleteConfirm(true)}
          onSelectAll={() => selection.selectAll(allSelectableIds)}
          onDeselectAll={selection.deselectAll}
          onCancel={selection.exitSelectionMode}
        />
      )}

      {/* Undo toast */}
      {undoToast && (
        <UndoToast
          message={undoToast.message}
          onUndo={handleUndoArchive}
          onDismiss={() => setUndoToast(null)}
        />
      )}

      {/* Batch delete confirmation */}
      {showDeleteConfirm && selectedSessions.length > 0 && (
        <BatchDeleteConfirmDialog
          sessions={selectedSessions}
          onConfirm={handleBatchDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
