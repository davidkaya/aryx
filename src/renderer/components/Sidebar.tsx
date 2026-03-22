import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitFork,
  ListOrdered,
  Lock,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { OrchestrationMode, PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import type { WorkspaceState } from '@shared/domain/workspace';

interface SidebarProps {
  workspace: WorkspaceState;
  onAddProject: () => void;
  onNewSession: () => void;
  onProjectSelect: (projectId?: string) => void;
  onSessionSelect: (sessionId: string) => void;
  onOpenSettings: () => void;
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

/* ── Session item ──────────────────────────────────────────── */

function SessionItem({
  session,
  pattern,
  isActive,
  onSelect,
}: {
  session: SessionRecord;
  pattern?: PatternDefinition;
  isActive: boolean;
  onSelect: () => void;
}) {
  const isRunning = session.status === 'running';
  const isError = session.status === 'error';
  const mode = pattern?.mode ?? 'single';
  const visual = modeVisuals[mode];
  const ModeIcon = visual.icon;
  const agentCount = pattern?.agents.length ?? 1;

  return (
    <button
      className={`group relative flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
        isActive
          ? 'bg-indigo-500/10 ring-1 ring-indigo-500/25'
          : 'hover:bg-zinc-800/60'
      } ${isRunning ? 'sidebar-running' : ''}`}
      onClick={onSelect}
      type="button"
    >
      {/* Running left accent bar */}
      {isRunning && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-blue-400 sidebar-pulse" />
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
          <span
            className={`truncate text-[13px] font-medium leading-tight ${
              isActive ? 'text-indigo-100' : 'text-zinc-200 group-hover:text-zinc-100'
            }`}
          >
            {session.title}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-2">
          {/* Agent count badge for multi-agent patterns */}
          {agentCount > 1 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
              <Users className="size-2.5" />
              {agentCount}
            </span>
          )}

          {/* Status indicator */}
          {isRunning && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-400">
              <span className="size-1.5 rounded-full bg-blue-400 sidebar-pulse" />
              Running
            </span>
          )}
          {isError && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-400">
              <span className="size-1.5 rounded-full bg-red-400" />
              Error
            </span>
          )}

          {/* Relative time */}
          <span className="ml-auto text-[10px] text-zinc-600 group-hover:text-zinc-500">
            {relativeTime(session.updatedAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ── Project group ─────────────────────────────────────────── */

function ProjectGroup({
  project,
  sessions,
  patterns,
  selectedSessionId,
  onSessionSelect,
}: {
  project: ProjectRecord;
  sessions: SessionRecord[];
  patterns: PatternDefinition[];
  selectedSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isScratchpad = isScratchpadProject(project);

  const patternMap = useMemo(() => {
    const map = new Map<string, PatternDefinition>();
    for (const p of patterns) map.set(p.id, p);
    return map;
  }, [patterns]);

  const runningCount = sessions.filter((s) => s.status === 'running').length;

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

        <div className="ml-auto flex items-center gap-1.5">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
              <span className="size-1.5 rounded-full bg-blue-400 sidebar-pulse" />
              {runningCount}
            </span>
          )}
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
            {sessions.length}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-zinc-800/60 pl-2">
          {sessions.length === 0 ? (
            <div className="px-3 py-3 text-center text-[12px] text-zinc-600">
              {isScratchpad ? 'No scratchpad chats yet' : 'No sessions yet'}
            </div>
          ) : (
            sessions.map((session) => (
              <SessionItem
                isActive={selectedSessionId === session.id}
                key={session.id}
                onSelect={() => onSessionSelect(session.id)}
                pattern={patternMap.get(session.patternId)}
                session={session}
              />
            ))
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
  onNewSession,
  onProjectSelect,
  onSessionSelect,
  onOpenSettings,
}: SidebarProps) {
  const scratchpadProject = workspace.projects.find((project) => isScratchpadProject(project));
  const userProjects = workspace.projects.filter((project) => !isScratchpadProject(project));

  return (
    <div className="flex h-full flex-col">
      {/* Header — extra top padding clears the title bar overlay zone */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 pb-3 pt-12">
        <div className="flex items-center gap-2.5">
          <div className="relative flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-[12px] font-bold text-white shadow-lg shadow-indigo-500/20">
            <Sparkles className="size-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-zinc-100">kopaya</span>
            <span className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[9px] font-medium text-zinc-500">
              BETA
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="flex size-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onOpenSettings}
            title="Settings"
            type="button"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>

      {/* New session CTA */}
      <div className="px-3 pt-3 pb-1">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-800/30 px-3 py-2 text-[13px] font-medium text-zinc-400 transition hover:border-indigo-500/40 hover:bg-indigo-500/5 hover:text-indigo-300"
          onClick={onNewSession}
          type="button"
        >
          <Plus className="size-4" />
          New Session
        </button>
      </div>

      {/* Project + Session Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-3">
          {scratchpadProject && (
            <div className="space-y-1">
              <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                Scratchpad
              </div>
              <ProjectGroup
                key={scratchpadProject.id}
                onSessionSelect={onSessionSelect}
                patterns={workspace.patterns}
                project={scratchpadProject}
                selectedSessionId={workspace.selectedSessionId}
                sessions={workspace.sessions.filter((session) => session.projectId === scratchpadProject.id)}
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
                  patterns={workspace.patterns}
                  project={project}
                  selectedSessionId={workspace.selectedSessionId}
                  sessions={workspace.sessions.filter((session) => session.projectId === project.id)}
                />
              ))}
            </div>
          )}
        </div>
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
    </div>
  );
}
