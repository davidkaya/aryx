import type { PatternDefinition } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import type { WorkspaceState } from '@shared/domain/workspace';

interface SidebarProps {
  workspace: WorkspaceState;
  onAddProject: () => void;
  onCreateSession: () => void;
  onNewPattern: () => void;
  onProjectSelect: (projectId?: string) => void;
  onPatternSelect: (patternId?: string) => void;
  onSessionSelect: (sessionId?: string) => void;
}

function itemClasses(active: boolean) {
  return active
    ? 'w-full rounded-lg border border-sky-500/60 bg-sky-500/10 px-3 py-2 text-left text-sm text-sky-200'
    : 'w-full rounded-lg border border-transparent px-3 py-2 text-left text-sm text-slate-300 transition hover:border-slate-700 hover:bg-slate-800/70';
}

function modeBadge(pattern: PatternDefinition) {
  if (pattern.availability === 'unavailable') {
    return 'bg-amber-500/15 text-amber-200';
  }

  return 'bg-emerald-500/10 text-emerald-200';
}

function sessionCountLabel(project: ProjectRecord, sessions: SessionRecord[]) {
  const count = sessions.filter((session) => session.projectId === project.id).length;
  return `${count} session${count === 1 ? '' : 's'}`;
}

export function Sidebar({
  workspace,
  onAddProject,
  onCreateSession,
  onNewPattern,
  onProjectSelect,
  onPatternSelect,
  onSessionSelect,
}: SidebarProps) {
  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">kopaya</div>
            <h1 className="mt-1 text-xl font-semibold text-white">Agent Orchestrator</h1>
            <p className="mt-1 text-sm text-slate-400">
              React + Electron frontend with a bundled .NET sidecar.
            </p>
          </div>
          <button
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
            onClick={onAddProject}
            type="button"
          >
            Add Project
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <section>
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Patterns</h2>
              <p className="text-xs text-slate-500">Global orchestration library</p>
            </div>
            <button
              className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              onClick={onNewPattern}
              type="button"
            >
              New Pattern
            </button>
          </div>
          <div className="space-y-2">
            {workspace.patterns.map((pattern) => (
              <button
                className={itemClasses(workspace.selectedPatternId === pattern.id && !workspace.selectedSessionId)}
                key={pattern.id}
                onClick={() => onPatternSelect(pattern.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-100">{pattern.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{pattern.description}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ${modeBadge(pattern)}`}>
                    {pattern.mode}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Projects</h2>
              <p className="text-xs text-slate-500">Workspace folders and their sessions</p>
            </div>
            <button
              className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              disabled={!workspace.selectedProjectId || !workspace.selectedPatternId}
              onClick={onCreateSession}
              type="button"
            >
              New Session
            </button>
          </div>

          <div className="space-y-3">
            {workspace.projects.map((project) => {
              const sessions = workspace.sessions.filter((session) => session.projectId === project.id);
              return (
                <div
                  className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                  key={project.id}
                >
                  <button
                    className={itemClasses(workspace.selectedProjectId === project.id && !workspace.selectedSessionId)}
                    onClick={() => onProjectSelect(project.id)}
                    type="button"
                  >
                    <div className="font-medium text-slate-100">{project.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{project.path}</div>
                    <div className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
                      {sessionCountLabel(project, sessions)}
                    </div>
                  </button>

                  {sessions.length > 0 ? (
                    <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                      {sessions.map((session) => (
                        <button
                          className={itemClasses(workspace.selectedSessionId === session.id)}
                          key={session.id}
                          onClick={() => onSessionSelect(session.id)}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-100">{session.title}</div>
                              <div className="mt-1 text-xs text-slate-400">
                                {session.messages.length} message{session.messages.length === 1 ? '' : 's'}
                              </div>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                                session.status === 'error'
                                  ? 'bg-rose-500/15 text-rose-200'
                                  : session.status === 'running'
                                    ? 'bg-sky-500/15 text-sky-200'
                                    : 'bg-slate-700 text-slate-200'
                              }`}
                            >
                              {session.status}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-dashed border-slate-800 px-3 py-2 text-xs text-slate-500">
                      No sessions yet. Select a pattern, then start one.
                    </div>
                  )}
                </div>
              );
            })}

            {workspace.projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 px-4 py-5 text-sm text-slate-400">
                Add one or more project folders to begin orchestrating sessions.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
