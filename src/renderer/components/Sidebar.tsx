import { useEffect, useMemo, useRef, useState } from 'react';
import appIconUrl from '../../../assets/icons/icon.png';
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  FolderOpen,
  GitBranch,
  GitFork,
  ListOrdered,
  Lock,
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

import type { OrchestrationMode, PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord, type ProjectGitContext } from '@shared/domain/project';
import { listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { SessionRecord } from '@shared/domain/session';
import { querySessions } from '@shared/domain/sessionLibrary';
import type { WorkspaceState } from '@shared/domain/workspace';

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
  onRefreshGitContext: (projectId: string) => void;
}

/* ── Mode icon + accent colour mapping ─────────────────────── */

const modeVisuals: Record<OrchestrationMode, { icon: LucideIcon; color: string }> = {
  single: { icon: MessageSquare, color: 'text-[#245CF9]' },
  sequential: { icon: ListOrdered, color: 'text-[var(--color-status-warning)]' },
  concurrent: { icon: GitFork, color: 'text-[var(--color-status-success)]' },
  handoff: { icon: ArrowLeftRight, color: 'text-[var(--color-accent-sky)]' },
  'group-chat': { icon: Users, color: 'text-[var(--color-accent-purple)]' },
  magentic: { icon: Lock, color: 'text-[var(--color-text-muted)]' },
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

  return (
    <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]" title={parts.join(' · ') || branchLabel}>
      <GitBranch className="size-2.5 shrink-0" />
      <span className="max-w-[80px] truncate">{branchLabel}</span>
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
  pattern,
  isActive,
  isRenaming,
  onSelect,
  onOpenMenu,
  onRenameSubmit,
  onRenameCancel,
}: {
  session: SessionRecord;
  pattern?: PatternDefinition;
  isActive: boolean;
  isRenaming: boolean;
  onSelect: () => void;
  onOpenMenu: (e: React.MouseEvent) => void;
  onRenameSubmit: (title: string) => void;
  onRenameCancel: () => void;
}) {
  const isRunning = session.status === 'running';
  const isError = session.status === 'error';
  const hasPendingApproval = session.pendingApproval?.status === 'pending';
  const queuedCount = (session.pendingApprovalQueue ?? []).filter((a) => a.status === 'pending').length;
  const mode = pattern?.mode ?? 'single';
  const visual = modeVisuals[mode];
  const ModeIcon = visual.icon;
  const agentCount = pattern?.agents.length ?? 1;

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

  return (
    <div
      className={`group relative flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-200 ${
        isActive
          ? 'bg-[var(--color-accent-muted)] ring-1 ring-[var(--color-border-glow)]'
          : 'hover:bg-[var(--color-surface-2)]/60'
      } ${isRunning ? 'sidebar-running' : ''} ${session.isArchived ? 'opacity-50' : ''}`}
      onClick={isRenaming ? undefined : onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !isRenaming) { e.preventDefault(); onSelect(); } }}
    >
      {/* Running/approval left accent bar */}
      {isRunning && !hasPendingApproval && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full accent-flow" />
      )}
      {hasPendingApproval && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[var(--color-status-warning)]" />
      )}

      {/* Mode icon */}
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ${
          isActive ? 'bg-[var(--color-accent-muted)]' : 'bg-[var(--color-surface-2)]'
        }`}
      >
        <ModeIcon className={`size-3.5 ${isActive ? 'text-[var(--color-accent)]' : visual.color}`} />
      </span>

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
          <span className="ml-auto text-[10px] text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]">
            {relativeTime(session.updatedAt)}
          </span>
        </div>
      </div>

      {/* Actions button (hidden during rename) */}
      {!isRenaming && (
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
  patterns,
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
}: {
  project: ProjectRecord;
  sessions: SessionRecord[];
  patterns: PatternDefinition[];
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
}){
  const [expanded, setExpanded] = useState(true);
  const isScratchpad = isScratchpadProject(project);

  const patternMap = useMemo(() => {
    const map = new Map<string, PatternDefinition>();
    for (const p of patterns) map.set(p.id, p);
    return map;
  }, [patterns]);

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
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-semibold text-[var(--color-text-secondary)] transition-all duration-150 hover:bg-[var(--color-surface-2)]/40 hover:text-[var(--color-text-primary)]"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
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
        <span className="truncate">{project.name}</span>

        {!isScratchpad && project.git && (
          <GitContextBadge git={project.git} />
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!isScratchpad && onOpenProjectSettings && (
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
          {!isScratchpad && onRefreshGitContext && (
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
          <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
            {visibleSessions.length}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-[var(--color-border-subtle)] pl-2">
          {visibleSessions.length > 0 &&
            visibleSessions.map((session) => (
              <SessionItem
                isActive={selectedSessionId === session.id}
                isRenaming={renamingSessionId === session.id}
                key={session.id}
                onSelect={() => onSessionSelect(session.id)}
                onOpenMenu={(e) => onOpenMenu(session.id, e)}
                onRenameSubmit={(title) => onRenameSubmit(session.id, title)}
                onRenameCancel={onRenameCancel}
                pattern={patternMap.get(session.patternId)}
                session={session}
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
  onRefreshGitContext,
}: SidebarProps) {
  const scratchpadProject = workspace.projects.find((project) => isScratchpadProject(project));
  const userProjects = workspace.projects.filter((project) => !isScratchpadProject(project));

  /* ── Search & filter state ─────────────────────────────────── */

  const [searchText, setSearchText] = useState('');

  const isQueryActive = searchText.trim().length > 0;

  const patternMap = useMemo(() => {
    const map = new Map<string, PatternDefinition>();
    for (const p of workspace.patterns) map.set(p.id, p);
    return map;
  }, [workspace.patterns]);

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

  return (
    <div className="flex h-full flex-col">
      {/* Header — extra top padding clears the title bar overlay zone */}
      <div className="drag-region flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 pb-3 pt-3">
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
              queryResults.map((session) => (
                <SessionItem
                  isActive={workspace.selectedSessionId === session.id}
                  isRenaming={renamingSessionId === session.id}
                  key={session.id}
                  onSelect={() => onSessionSelect(session.id)}
                  onOpenMenu={(e) => handleOpenMenu(session.id, e)}
                  onRenameSubmit={(title) => handleRenameSubmit(session.id, title)}
                  onRenameCancel={() => setRenamingSessionId(undefined)}
                  pattern={patternMap.get(session.patternId)}
                  session={session}
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
                  patterns={workspace.patterns}
                  project={scratchpadProject}
                  selectedSessionId={workspace.selectedSessionId}
                  sessions={workspace.sessions.filter((session) => session.projectId === scratchpadProject.id)}
                  onNewSession={onCreateScratchpad}
                  newSessionLabel="New Scratchpad"
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
                    patterns={workspace.patterns}
                    project={project}
                    selectedSessionId={workspace.selectedSessionId}
                    sessions={workspace.sessions.filter((session) => session.projectId === project.id)}
                    onNewSession={() => onNewProjectSession(project.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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
      {menuState && menuSession && (
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
    </div>
  );
}
