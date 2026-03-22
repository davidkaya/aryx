import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@renderer/components/AppShell';
import { ActivityPanel } from '@renderer/components/ActivityPanel';
import { ChatPane } from '@renderer/components/ChatPane';
import { NewSessionModal } from '@renderer/components/NewSessionModal';
import { SettingsPanel } from '@renderer/components/SettingsPanel';
import { Sidebar } from '@renderer/components/Sidebar';
import {
  applySessionEventActivity,
  pruneSessionActivities,
  type SessionActivityMap,
} from '@renderer/lib/sessionActivity';
import { applySessionEventWorkspace } from '@renderer/lib/sessionWorkspace';
import { WelcomePane } from '@renderer/components/WelcomePane';
import { getElectronApi } from '@renderer/lib/electronApi';
import type { SidecarCapabilities } from '@shared/contracts/sidecar';
import {
  buildAvailableModelCatalog,
  findModel,
  normalizePatternModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import type { PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject } from '@shared/domain/project';
import { applyScratchpadSessionConfig } from '@shared/domain/session';
import type { WorkspaceState } from '@shared/domain/workspace';
import { createId, nowIso } from '@shared/utils/ids';

function createDraftPattern(defaultModelId: string, defaultReasoningEffort: PatternDefinition['agents'][0]['reasoningEffort']): PatternDefinition {
  const timestamp = nowIso();
  return {
    id: createId('custom-pattern'),
    name: 'New Pattern',
    description: '',
    mode: 'single',
    availability: 'available',
    maxIterations: 1,
    agents: [
      {
        id: createId('agent'),
        name: 'Primary Agent',
        description: 'General-purpose assistant.',
        instructions: 'You are a helpful coding assistant working inside the selected project.',
        model: defaultModelId,
        reasoningEffort: defaultReasoningEffort,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export default function App() {
  const api = getElectronApi();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [error, setError] = useState<string>();
  const [sidecarCapabilities, setSidecarCapabilities] = useState<SidecarCapabilities>();
  const [sessionActivities, setSessionActivities] = useState<SessionActivityMap>({});

  const [showSettings, setShowSettings] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);

  // Load workspace on mount
  useEffect(() => {
    let disposed = false;

    void api
      .loadWorkspace()
      .then((ws) => !disposed && setWorkspace(ws))
      .catch((e) => !disposed && setError(e instanceof Error ? e.message : String(e)));
    void api
      .describeSidecarCapabilities()
      .then((capabilities) => !disposed && setSidecarCapabilities(capabilities))
      .catch((e) => {
        if (!disposed) {
          console.warn('Failed to load sidecar capabilities', e);
        }
      });

    const offWorkspace = api.onWorkspaceUpdated((ws) => {
      setWorkspace(ws);
      setError(undefined);
      setSessionActivities((current) =>
        pruneSessionActivities(
          current,
          ws.sessions.map((session) => session.id),
        ),
      );
    });

    const offSessionEvent = api.onSessionEvent((event) => {
      setWorkspace((current) => applySessionEventWorkspace(current, event));
      setSessionActivities((current) => applySessionEventActivity(current, event));
    });

    return () => {
      disposed = true;
      offWorkspace();
      offSessionEvent();
    };
  }, [api]);

  // Derived state
  const selectedSession = useMemo(
    () => workspace?.sessions.find((s) => s.id === workspace.selectedSessionId),
    [workspace?.selectedSessionId, workspace?.sessions],
  );
  const projectForSession = useMemo(
    () =>
      selectedSession
        ? workspace?.projects.find((p) => p.id === selectedSession.projectId)
        : undefined,
    [selectedSession, workspace?.projects],
  );
  const availableModels = useMemo(
    () => buildAvailableModelCatalog(sidecarCapabilities?.models),
    [sidecarCapabilities?.models],
  );
  const patternForSession = useMemo(() => {
    if (!selectedSession) {
      return undefined;
    }

    const basePattern = workspace?.patterns.find((pattern) => pattern.id === selectedSession.patternId);
    if (!basePattern) {
      return undefined;
    }

    const patternWithSessionConfig =
      projectForSession && isScratchpadProject(projectForSession)
        ? applyScratchpadSessionConfig(basePattern, selectedSession)
        : basePattern;

    return normalizePatternModels(patternWithSessionConfig, availableModels);
  }, [availableModels, projectForSession, selectedSession, workspace?.patterns]);
  const activityForSession = useMemo(
    () => (selectedSession ? sessionActivities[selectedSession.id] : undefined),
    [selectedSession, sessionActivities],
  );
  const hasUserProjects = useMemo(
    () => (workspace?.projects.some((project) => !isScratchpadProject(project)) ?? false),
    [workspace?.projects],
  );

  // Loading state
  if (!workspace) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-surface-0)]">
        <div className="text-sm text-zinc-500">Loading workspace…</div>
      </div>
    );
  }

  // Determine main content
  let content: React.ReactNode;
  let detailPanel: React.ReactNode | undefined;
  if (error) {
    content = (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <h2 className="text-sm font-semibold text-red-300">Something went wrong</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-red-400/80">{error}</p>
        </div>
      </div>
    );
  } else if (selectedSession && patternForSession && projectForSession) {
    content = (
        <ChatPane
          onSend={(c) => api.sendSessionMessage({ sessionId: selectedSession.id, content: c })}
          onUpdateScratchpadConfig={(config) =>
            api.updateScratchpadSessionConfig({
              sessionId: selectedSession.id,
              model: config.model,
              reasoningEffort: config.reasoningEffort,
            })
          }
          availableModels={availableModels}
          pattern={patternForSession}
          project={projectForSession}
          session={selectedSession}
        />
    );
    detailPanel = (
      <ActivityPanel
        activity={activityForSession}
        pattern={patternForSession}
        session={selectedSession}
      />
    );
  } else {
    content = (
      <WelcomePane
        hasProjects={hasUserProjects}
        onAddProject={() => void api.addProject()}
        onNewSession={() => setShowNewSession(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
    );
  }

  // Settings overlay
  const overlay = showSettings ? (
      <SettingsPanel
        availableModels={availableModels}
        onClose={() => setShowSettings(false)}
      onDeletePattern={async (id) => {
        await api.deletePattern(id);
      }}
      onNewPattern={() => {
        const defaultModel = availableModels[0] ?? findModel('gpt-5.4', availableModels) ?? findModel('gpt-5.4');

        return createDraftPattern(
          defaultModel?.id ?? 'gpt-5.4',
          resolveReasoningEffort(defaultModel, 'high'),
        );
      }}
      onSavePattern={async (pattern) => {
        await api.savePattern({ pattern });
      }}
      patterns={workspace.patterns}
    />
  ) : null;

  return (
    <>
      <AppShell
        content={content}
        detailPanel={detailPanel}
        overlay={overlay}
        sidebar={
          <Sidebar
            onAddProject={() => void api.addProject()}
            onNewSession={() => setShowNewSession(true)}
            onOpenSettings={() => setShowSettings(true)}
            onProjectSelect={(projectId) => {
              void api.selectProject(projectId);
            }}
            onSessionSelect={(sessionId) => {
              void api.selectSession(sessionId);
            }}
            workspace={workspace}
          />
        }
      />

      {showNewSession && (
        <NewSessionModal
          defaultProjectId={workspace.selectedProjectId}
          onClose={() => setShowNewSession(false)}
          onCreate={(projectId, patternId) => {
            setShowNewSession(false);
            void api.createSession({ projectId, patternId });
          }}
          patterns={workspace.patterns}
          projects={workspace.projects}
        />
      )}
    </>
  );
}
