import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@renderer/components/AppShell';
import { ChatPane } from '@renderer/components/ChatPane';
import { PatternEditor } from '@renderer/components/PatternEditor';
import { Sidebar } from '@renderer/components/Sidebar';
import { getElectronApi } from '@renderer/lib/electronApi';
import type { PatternDefinition } from '@shared/domain/pattern';
import { createBuiltinPatterns } from '@shared/domain/pattern';
import type { WorkspaceState } from '@shared/domain/workspace';
import { createId, nowIso } from '@shared/utils/ids';

function clonePattern(pattern: PatternDefinition): PatternDefinition {
  return structuredClone(pattern);
}

function createDraftPattern(): PatternDefinition {
  const timestamp = nowIso();
  return {
    id: createId('pattern'),
    name: 'New Pattern',
    description: 'Reusable orchestration pattern.',
    mode: 'single',
    availability: 'available',
    maxIterations: 1,
    agents: [
      {
        id: createId('agent'),
        name: 'Primary Agent',
        description: 'General-purpose project assistant.',
        instructions: 'You are a helpful coding assistant working inside the selected project.',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function EmptyDetail() {
  const patterns = createBuiltinPatterns(nowIso());
  return (
    <div className="flex h-screen items-center justify-center px-10">
      <div className="max-w-3xl rounded-3xl border border-slate-800 bg-slate-900/70 p-10">
        <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Workspace Overview</div>
        <h2 className="mt-3 text-3xl font-semibold text-white">Chat-first orchestration across projects</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          Select a pattern to edit it, add one or more projects on the left, and start sessions that bind a
          project folder to a reusable orchestration blueprint.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {patterns.map((pattern) => (
            <div
              className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              key={pattern.id}
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-slate-100">{pattern.name}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                    pattern.availability === 'unavailable'
                      ? 'bg-amber-500/15 text-amber-200'
                      : 'bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  {pattern.mode}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{pattern.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const api = getElectronApi();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [draftPattern, setDraftPattern] = useState<PatternDefinition | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;

    void api
      .loadWorkspace()
      .then((nextWorkspace) => {
        if (!disposed) {
          setWorkspace(nextWorkspace);
        }
      })
      .catch((nextError) => {
        if (!disposed) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });

    const offWorkspace = api.onWorkspaceUpdated((nextWorkspace) => {
      setWorkspace(nextWorkspace);
      setError(undefined);
    });

    return () => {
      disposed = true;
      offWorkspace();
    };
  }, [api]);

  useEffect(() => {
    if (!workspace?.selectedPatternId) {
      setDraftPattern(null);
      return;
    }

    const selectedPattern = workspace.patterns.find((pattern) => pattern.id === workspace.selectedPatternId);
    setDraftPattern(selectedPattern ? clonePattern(selectedPattern) : null);
  }, [workspace?.lastUpdatedAt, workspace?.selectedPatternId, workspace?.patterns]);

  const selectedSession = useMemo(
    () => workspace?.sessions.find((session) => session.id === workspace.selectedSessionId),
    [workspace?.selectedSessionId, workspace?.sessions],
  );
  const selectedPattern = useMemo(
    () =>
      draftPattern ??
      workspace?.patterns.find((pattern) => pattern.id === workspace.selectedPatternId),
    [draftPattern, workspace?.patterns, workspace?.selectedPatternId],
  );
  const selectedProject = useMemo(
    () => workspace?.projects.find((project) => project.id === workspace.selectedProjectId),
    [workspace?.projects, workspace?.selectedProjectId],
  );

  if (!workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        Loading workspace…
      </div>
    );
  }

  const patternForSession = selectedSession
    ? workspace.patterns.find((pattern) => pattern.id === selectedSession.patternId)
    : undefined;
  const projectForSession = selectedSession
    ? workspace.projects.find((project) => project.id === selectedSession.projectId)
    : undefined;

  return (
    <AppShell
      content={
        error ? (
          <div className="flex h-screen items-center justify-center px-10">
            <div className="max-w-lg rounded-3xl border border-rose-500/40 bg-rose-500/10 p-8 text-rose-100">
              <div className="text-xs uppercase tracking-[0.2em] text-rose-200">Error</div>
              <h2 className="mt-3 text-2xl font-semibold">Something went wrong</h2>
              <p className="mt-3 text-sm leading-7">{error}</p>
            </div>
          </div>
        ) : selectedSession && patternForSession && projectForSession ? (
          <ChatPane
            onSend={(content) => api.sendSessionMessage({ sessionId: selectedSession.id, content })}
            pattern={patternForSession}
            project={projectForSession}
            session={selectedSession}
          />
        ) : selectedPattern ? (
          <PatternEditor
            isBuiltin={selectedPattern.id.startsWith('pattern-')}
            onChange={setDraftPattern}
            onDelete={
              selectedPattern.id.startsWith('pattern-')
                ? undefined
                : async () => {
                    await api.deletePattern(selectedPattern.id);
                  }
            }
            onSave={async () => {
              await api.savePattern({ pattern: draftPattern ?? selectedPattern });
            }}
            pattern={draftPattern ?? selectedPattern}
          />
        ) : (
          <EmptyDetail />
        )
      }
      sidebar={
        <Sidebar
          onAddProject={() => {
            void api.addProject();
          }}
          onCreateSession={() => {
            if (!workspace.selectedProjectId || !workspace.selectedPatternId) {
              return;
            }

            void api.createSession({
              projectId: workspace.selectedProjectId,
              patternId: workspace.selectedPatternId,
            });
          }}
          onNewPattern={() => {
            setDraftPattern(createDraftPattern());
            void api.selectPattern(undefined);
            void api.selectSession(undefined);
          }}
          onPatternSelect={(patternId) => {
            void api.selectPattern(patternId);
            void api.selectSession(undefined);
          }}
          onProjectSelect={(projectId) => {
            void api.selectProject(projectId);
            void api.selectSession(undefined);
          }}
          onSessionSelect={(sessionId) => {
            void api.selectSession(sessionId);
          }}
          workspace={workspace}
        />
      }
    />
  );
}
