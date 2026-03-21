import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  MessageSquare,
  Plus,
  Settings,
} from 'lucide-react';

import type { ProjectRecord } from '@shared/domain/project';
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

function statusDot(status: SessionRecord['status']) {
  if (status === 'running') return 'bg-blue-400';
  if (status === 'error') return 'bg-red-400';
  return 'bg-zinc-600';
}

function ProjectGroup({
  project,
  sessions,
  selectedSessionId,
  onSessionSelect,
}: {
  project: ProjectRecord;
  sessions: SessionRecord[];
  selectedSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-200"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        <FolderOpen className="size-3.5 shrink-0 text-zinc-500" />
        <span className="truncate">{project.name}</span>
        <span className="ml-auto text-[11px] text-zinc-600">{sessions.length}</span>
      </button>

      {expanded && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-zinc-800 pl-3">
          {sessions.length === 0 ? (
            <div className="px-2 py-1.5 text-[12px] text-zinc-600">No sessions yet</div>
          ) : (
            sessions.map((session) => {
              const isActive = selectedSessionId === session.id;
              return (
                <button
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${
                    isActive
                      ? 'bg-[var(--color-accent-muted)] text-indigo-200'
                      : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
                  }`}
                  key={session.id}
                  onClick={() => onSessionSelect(session.id)}
                  type="button"
                >
                  <MessageSquare className="size-3.5 shrink-0 text-zinc-500" />
                  <span className="truncate">{session.title}</span>
                  <span className={`ml-auto size-2 shrink-0 rounded-full ${statusDot(session.status)}`} />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  workspace,
  onAddProject,
  onNewSession,
  onProjectSelect,
  onSessionSelect,
  onOpenSettings,
}: SidebarProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header — extra top padding clears the title bar overlay zone */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 pb-3 pt-12">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-[11px] font-bold text-white">
            K
          </div>
          <span className="text-sm font-semibold text-zinc-100">kopaya</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onOpenSettings}
            title="Settings"
            type="button"
          >
            <Settings className="size-4" />
          </button>
          <button
            className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-500"
            onClick={onNewSession}
            title="New session"
            type="button"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      {/* Project + Session Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {workspace.projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <FolderOpen className="size-8 text-zinc-700" />
            <div>
              <p className="text-sm text-zinc-400">No projects yet</p>
              <p className="mt-1 text-[12px] text-zinc-600">
                Add a project folder to start orchestrating
              </p>
            </div>
            <button
              className="mt-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
              onClick={onAddProject}
              type="button"
            >
              Add Project
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {workspace.projects.map((project) => (
              <ProjectGroup
                key={project.id}
                onSessionSelect={onSessionSelect}
                project={project}
                selectedSessionId={workspace.selectedSessionId}
                sessions={workspace.sessions.filter((s) => s.projectId === project.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {workspace.projects.length > 0 && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-300"
            onClick={onAddProject}
            type="button"
          >
            <Plus className="size-3.5" />
            Add project
          </button>
        </div>
      )}
    </div>
  );
}
