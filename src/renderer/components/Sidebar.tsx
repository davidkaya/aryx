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
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import type { OrchestrationMode, PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord, type ProjectGitContext } from '@shared/domain/project';
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
  onRenameSession: (sessionId: string, title: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onSetSessionPinned: (sessionId: string, isPinned: boolean) => void;
  onSetSessionArchived: (sessionId: string, isArchived: boolean) => void;
  onRefreshGitContext: (projectId: string) => void;
}

/* ── Mode icon + accent colour mapping ─────────────────────── */

const modeVisuals: Record<OrchestrationMode, { icon: LucideIcon; color: string }> = {
  single: { icon: MessageSquare, color: 'text-indigo-400' },
  sequential: { icon: ListOrdered, color: 'text-amber-400' },
  concurrent: { icon: GitFork, color: 'text-emerald-400' },
  handoff: { icon: ArrowLeftRight, color: 'text-sky-400' },
  'group-chat': { icon: Users, color: 'text-violet-400' },
  magentic: { icon: Lock, color: 'text-zinc-500' },
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
      <span className="text-[10px] text-zinc-600" title="Not a git repository">
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
    <span className="flex items-center gap-1 text-[10px] text-zinc-500" title={parts.join(' · ') || branchLabel}>
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
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-zinc-300 transition hover:bg-zinc-800"
      onClick={onClick}
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
      className={`group relative flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
        isActive
          ? 'bg-indigo-500/10 ring-1 ring-indigo-500/25'
          : 'hover:bg-zinc-800/60'
      } ${isRunning ? 'sidebar-running' : ''} ${session.isArchived ? 'opacity-50' : ''}`}
      onClick={isRenaming ? undefined : onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && !isRenaming) onSelect(); }}
    >
      {/* Running/approval left accent bar */}
      {isRunning && !hasPendingApproval && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-blue-400 sidebar-pulse" />
      )}
      {hasPendingApproval && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-amber-400" />
      )}

      {/* Mode icon */}
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ${
          isActive ? 'bg-indigo-500/15' : 'bg-zinc-800/80'
        }`}
      >
        <ModeIcon className={`size-3.5 ${isActive ? 'text-indigo-400' : visual.color}`} />
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {session.isPinned && <Pin className="size-3 shrink-0 text-amber-500/70" />}
          {isRenaming ? (
            <input
              ref={inputRef}
              className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-[13px] font-medium text-zinc-100 outline-none ring-1 ring-indigo-500/50"
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className={`truncate text-[13px] font-medium leading-tight ${
                isActive ? 'text-indigo-100' : 'text-zinc-200 group-hover:text-zinc-100'
              }`}
            >
              {session.title}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2">
          {agentCount > 1 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
              <Users className="size-2.5" />
              {agentCount}
            </span>
          )}
          {isRunning && !hasPendingApproval && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-400">
              <span className="size-1.5 rounded-full bg-blue-400 sidebar-pulse" />
              Running
            </span>
          )}
          {hasPendingApproval && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
              <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
              Awaiting approval
            </span>
          )}
          {isError && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-400">
              <span className="size-1.5 rounded-full bg-red-400" />
              Error
            </span>
          )}
          {session.isArchived && (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
              <Archive className="size-2.5" />
              Archived
            </span>
          )}
          <span className="ml-auto text-[10px] text-zinc-600 group-hover:text-zinc-500">
            {relativeTime(session.updatedAt)}
          </span>
        </div>
      </div>

      {/* Actions button (hidden during rename) */}
      {!isRenaming && (
        <button
          className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-zinc-600 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
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

  return (
    <div>
      <button
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-semibold text-zinc-400 transition hover:bg-zinc-800/40 hover:text-zinc-200"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-zinc-500" />
        )}
        {isScratchpad ? (
          <MessageSquare className="size-3.5 shrink-0 text-zinc-500 transition group-hover:text-indigo-400" />
        ) : (
          <FolderOpen className="size-3.5 shrink-0 text-zinc-500 transition group-hover:text-indigo-400" />
        )}
        <span className="truncate">{project.name}</span>

        {!isScratchpad && project.git && (
          <GitContextBadge git={project.git} />
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!isScratchpad && onRefreshGitContext && (
            <span
              className="flex size-5 items-center justify-center rounded text-zinc-600 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
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
            <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
              <span className="size-1.5 rounded-full bg-blue-400 sidebar-pulse" />
              {runningCount}
            </span>
          )}
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
            {visibleSessions.length}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-zinc-800/60 pl-2">
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
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-700/60 bg-zinc-800/20 px-2.5 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:border-indigo-500/40 hover:bg-indigo-500/5 hover:text-indigo-300"
              onClick={onNewSession}
              type="button"
            >
              <Plus className="size-3.5" />
              {newSessionLabel ?? 'New Session'}
            </button>
          ) : (
            visibleSessions.length === 0 && (
              <div className="px-3 py-3 text-center text-[12px] text-zinc-600">
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
  onRenameSession,
  onDuplicateSession,
  onSetSessionPinned,
  onSetSessionArchived,
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
      <div className="drag-region flex items-center justify-between border-b border-[var(--color-border)] px-4 pb-3 pt-3">
        <div className="flex items-center gap-2.5">
          <img alt="eryx" className="size-8 rounded-xl" src={appIconUrl} />
          <div>
            <span className="text-sm font-semibold text-zinc-100">eryx</span>
            <span className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[9px] font-medium text-zinc-500">
              BETA
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="no-drag flex size-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
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
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-1.5 pl-8 pr-8 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-zinc-700 focus:bg-zinc-900"
            placeholder="Search sessions…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
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
            <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
              Results ({queryResults.length})
            </div>
            {queryResults.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-zinc-600">
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
                <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
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
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-zinc-800/50 ring-1 ring-zinc-700/50">
                    <FolderOpen className="size-7 text-zinc-600" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-indigo-600 ring-2 ring-[var(--color-surface-1)]">
                    <Plus className="size-3 text-white" />
                  </div>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-zinc-300">No projects yet</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                    Use Scratchpad for ad-hoc chat or add a repo<br />to work against project files
                  </p>
                </div>
                <button
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-indigo-500"
                  onClick={onAddProject}
                  type="button"
                >
                  Add Project
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
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
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-300"
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
          <div className="fixed inset-0 z-40" onClick={closeMenu} />
          <div
            className="fixed z-50 w-40 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
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
          </div>
        </>
      )}
    </div>
  );
}
