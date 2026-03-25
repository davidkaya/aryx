import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { useTheme, useSidecarCapabilities } from '@renderer/hooks/useAppHooks';
import {
  buildAvailableModelCatalog,
  findModel,
  normalizePatternModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import { syncPatternGraph, type PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, SCRATCHPAD_PROJECT_ID } from '@shared/domain/project';
import { applyScratchpadSessionConfig } from '@shared/domain/session';
import type { AppearanceTheme, LspProfileDefinition, McpServerDefinition } from '@shared/domain/tooling';
import type { WorkspaceState } from '@shared/domain/workspace';
import { createId, nowIso } from '@shared/utils/ids';

function createDraftPattern(defaultModelId: string, defaultReasoningEffort: PatternDefinition['agents'][0]['reasoningEffort']): PatternDefinition {
  const timestamp = nowIso();
  return syncPatternGraph({
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
  });
}

function createDraftMcpServer(): McpServerDefinition {
  const timestamp = nowIso();
  return {
    id: createId('mcp'),
    name: 'New MCP Server',
    transport: 'local',
    command: '',
    args: [],
    tools: ['*'],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createDraftLspProfile(): LspProfileDefinition {
  const timestamp = nowIso();
  return {
    id: createId('lsp'),
    name: 'New LSP Profile',
    command: '',
    args: ['--stdio'],
    languageId: 'typescript',
    fileExtensions: ['.ts', '.tsx'],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export default function App() {
  const api = getElectronApi();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [error, setError] = useState<string>();
  const { capabilities: sidecarCapabilities, isRefreshing: isRefreshingCapabilities, refresh: refreshCapabilities } = useSidecarCapabilities(api);
  const [sessionActivities, setSessionActivities] = useState<SessionActivityMap>({});

  const [showSettings, setShowSettings] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string>();

  // Load workspace on mount
  useEffect(() => {
    let disposed = false;

    void api
      .loadWorkspace()
      .then((ws) => !disposed && setWorkspace(ws))
      .catch((e) => !disposed && setError(e instanceof Error ? e.message : String(e)));

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

  // Apply theme to the document root
  const themeSetting: AppearanceTheme = workspace?.settings.theme ?? 'dark';
  useTheme(themeSetting);

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

  const jumpToMessage = useCallback((messageId: string) => {
    const element = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('ring-1', 'ring-indigo-500/40', 'rounded-lg');
      setTimeout(() => element.classList.remove('ring-1', 'ring-indigo-500/40', 'rounded-lg'), 1500);
    }
  }, []);

  const handleCreateScratchpad = useCallback(() => {
    if (!workspace) return;
    const singlePatterns = workspace.patterns
      .filter((p) => p.mode === 'single' && p.availability !== 'unavailable')
      .sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return 0;
      });

    const defaultPattern = singlePatterns[0];
    if (defaultPattern) {
      void api.createSession({ projectId: SCRATCHPAD_PROJECT_ID, patternId: defaultPattern.id });
    }
  }, [api, workspace]);

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
          onResolveApproval={(approvalId, decision) =>
            api.resolveSessionApproval({ sessionId: selectedSession.id, approvalId, decision })
          }
          onUpdateScratchpadConfig={(config) =>
            api.updateScratchpadSessionConfig({
              sessionId: selectedSession.id,
              model: config.model,
              reasoningEffort: config.reasoningEffort,
            })
          }
          onUpdateSessionTooling={(selection) => {
            void api.updateSessionTooling({
              sessionId: selectedSession.id,
              enabledMcpServerIds: selection.enabledMcpServerIds,
              enabledLspProfileIds: selection.enabledLspProfileIds,
            });
          }}
          onUpdateSessionApprovalSettings={(settings) => {
            void api.updateSessionApprovalSettings({
              sessionId: selectedSession.id,
              autoApprovedToolNames: settings.autoApprovedToolNames,
            });
          }}
          availableModels={availableModels}
          pattern={patternForSession}
          project={projectForSession}
          runtimeTools={sidecarCapabilities?.runtimeTools}
          session={selectedSession}
          toolingSettings={workspace.settings.tooling}
        />
    );
    detailPanel = (
      <ActivityPanel
        activity={activityForSession}
        onJumpToMessage={jumpToMessage}
        pattern={patternForSession}
        session={selectedSession}
      />
    );
  } else {
    content = (
      <WelcomePane
        hasProjects={hasUserProjects}
        onAddProject={() => void api.addProject()}
        onNewScratchpad={() => handleCreateScratchpad()}
        onOpenSettings={() => setShowSettings(true)}
      />
    );
  }

  // Settings overlay
  const overlay = showSettings ? (
      <SettingsPanel
        availableModels={availableModels}
        isRefreshingCapabilities={isRefreshingCapabilities}
        onClose={() => setShowSettings(false)}
        onDeleteLspProfile={async (id) => {
          await api.deleteLspProfile(id);
        }}
        onDeleteMcpServer={async (id) => {
          await api.deleteMcpServer(id);
        }}
        onDeletePattern={async (id) => {
          await api.deletePattern(id);
        }}
        onNewLspProfile={createDraftLspProfile}
        onNewMcpServer={createDraftMcpServer}
        onNewPattern={() => {
          const defaultModel = availableModels[0] ?? findModel('gpt-5.4', availableModels) ?? findModel('gpt-5.4');

          return createDraftPattern(
            defaultModel?.id ?? 'gpt-5.4',
            resolveReasoningEffort(defaultModel, 'high'),
          );
        }}
        onRefreshCapabilities={refreshCapabilities}
        onSaveLspProfile={async (profile) => {
          await api.saveLspProfile({ profile });
        }}
        onSaveMcpServer={async (server) => {
          await api.saveMcpServer({ server });
        }}
        onSavePattern={async (pattern) => {
          await api.savePattern({ pattern });
        }}
        onSetTheme={(theme) => void api.setTheme(theme)}
        patterns={workspace.patterns}
        sidecarCapabilities={sidecarCapabilities}
        theme={workspace.settings.theme}
        toolingSettings={workspace.settings.tooling}
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
            onCreateScratchpad={() => handleCreateScratchpad()}
            onNewProjectSession={(projectId) => {
              setNewSessionProjectId(projectId);
            }}
            onOpenSettings={() => setShowSettings(true)}
            onProjectSelect={(projectId) => {
              void api.selectProject(projectId);
            }}
            onSessionSelect={(sessionId) => {
              void api.selectSession(sessionId);
            }}
            onRenameSession={(sessionId, title) => {
              void api.renameSession({ sessionId, title });
            }}
            onDuplicateSession={(sessionId) => {
              void api.duplicateSession({ sessionId });
            }}
            onSetSessionPinned={(sessionId, isPinned) => {
              void api.setSessionPinned({ sessionId, isPinned });
            }}
            onSetSessionArchived={(sessionId, isArchived) => {
              void api.setSessionArchived({ sessionId, isArchived });
            }}
            onRefreshGitContext={(projectId) => {
              void api.refreshProjectGitContext(projectId);
            }}
            workspace={workspace}
          />
        }
      />

      {newSessionProjectId && (
        <NewSessionModal
          defaultProjectId={newSessionProjectId}
          onClose={() => setNewSessionProjectId(undefined)}
          onCreate={(projectId, patternId) => {
            setNewSessionProjectId(undefined);
            void api.createSession({ projectId, patternId });
          }}
          onTogglePatternFavorite={(patternId, isFavorite) => {
            void api.setPatternFavorite({ patternId, isFavorite });
          }}
          patterns={workspace.patterns}
          projects={workspace.projects}
        />
      )}
    </>
  );
}
