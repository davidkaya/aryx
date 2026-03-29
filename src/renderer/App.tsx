import { useCallback, useEffect, useMemo, useState } from 'react';

import { AppShell } from '@renderer/components/AppShell';
import { ActivityPanel } from '@renderer/components/ActivityPanel';
import { ChatPane } from '@renderer/components/ChatPane';
import { CommandPalette } from '@renderer/components/CommandPalette';
import { DiscoveredToolingModal } from '@renderer/components/DiscoveredToolingModal';
import { NewSessionModal } from '@renderer/components/NewSessionModal';
import { ProjectSettingsPanel } from '@renderer/components/ProjectSettingsPanel';
import { SettingsPanel } from '@renderer/components/SettingsPanel';
import { Sidebar } from '@renderer/components/Sidebar';
import { TerminalPanel, DEFAULT_HEIGHT as DEFAULT_TERMINAL_HEIGHT, MIN_HEIGHT as MIN_TERMINAL_HEIGHT } from '@renderer/components/TerminalPanel';
import { resolveChatToolingSettings } from '@renderer/lib/chatTooling';
import {
  applySessionEventActivity,
  applySessionUsageEvent,
  applyAssistantUsageEvent,
  applyTurnEventLog,
  pruneSessionActivities,
  pruneSessionUsage,
  pruneSessionRequestUsage,
  pruneTurnEventLogs,
  type SessionActivityMap,
  type SessionUsageMap,
  type SessionRequestUsageMap,
  type TurnEventLogMap,
} from '@renderer/lib/sessionActivity';
import { applySubagentEvent, pruneSubagentMap, type ActiveSubagentMap } from '@renderer/lib/subagentTracker';
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
import { createDefaultToolApprovalPolicy } from '@shared/domain/approval';
import { listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import { syncPatternGraph, type PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, SCRATCHPAD_PROJECT_ID } from '@shared/domain/project';
import { applySessionModelConfig } from '@shared/domain/session';
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
    approvalPolicy: createDefaultToolApprovalPolicy(),
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
  const [sessionUsage, setSessionUsage] = useState<SessionUsageMap>({});
  const [sessionRequestUsage, setSessionRequestUsage] = useState<SessionRequestUsageMap>({});
  const [turnEventLogs, setTurnEventLogs] = useState<TurnEventLogMap>({});
  const [activeSubagents, setActiveSubagents] = useState<ActiveSubagentMap>({});

  const [showSettings, setShowSettings] = useState(false);
  const [projectSettingsId, setProjectSettingsId] = useState<string>();
  const [newSessionProjectId, setNewSessionProjectId] = useState<string>();
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Terminal state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(
    () => workspace?.settings.terminalHeight ?? DEFAULT_TERMINAL_HEIGHT,
  );
  const [terminalRunning, setTerminalRunning] = useState(false);

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
      setSessionUsage((current) =>
        pruneSessionUsage(
          current,
          ws.sessions.map((session) => session.id),
        ),
      );
      setSessionRequestUsage((current) =>
        pruneSessionRequestUsage(
          current,
          ws.sessions.map((session) => session.id),
        ),
      );
      setTurnEventLogs((current) =>
        pruneTurnEventLogs(
          current,
          ws.sessions.map((session) => session.id),
        ),
      );
      setActiveSubagents((current) =>
        pruneSubagentMap(
          current,
          ws.sessions.map((session) => session.id),
        ),
      );
    });

    const offSessionEvent = api.onSessionEvent((event) => {
      setWorkspace((current) => applySessionEventWorkspace(current, event));
      setSessionActivities((current) => applySessionEventActivity(current, event));
      setSessionUsage((current) => applySessionUsageEvent(current, event));
      setSessionRequestUsage((current) => applyAssistantUsageEvent(current, event));
      setTurnEventLogs((current) => applyTurnEventLog(current, event));
      setActiveSubagents((current) => applySubagentEvent(current, event));
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
      projectForSession && selectedSession.sessionModelConfig
        ? applySessionModelConfig(basePattern, selectedSession)
        : basePattern;

    return normalizePatternModels(patternWithSessionConfig, availableModels);
  }, [availableModels, projectForSession, selectedSession, workspace?.patterns]);
  const activityForSession = useMemo(
    () => (selectedSession ? sessionActivities[selectedSession.id] : undefined),
    [selectedSession, sessionActivities],
  );
  const usageForSession = useMemo(
    () => (selectedSession ? sessionUsage[selectedSession.id] : undefined),
    [selectedSession, sessionUsage],
  );
  const requestUsageForSession = useMemo(
    () => (selectedSession ? sessionRequestUsage[selectedSession.id] : undefined),
    [selectedSession, sessionRequestUsage],
  );
  const subagentsForSession = useMemo(
    () => (selectedSession ? activeSubagents[selectedSession.id] : undefined),
    [selectedSession, activeSubagents],
  );
  const turnEventsForSession = useMemo(
    () => (selectedSession ? turnEventLogs[selectedSession.id] : undefined),
    [selectedSession, turnEventLogs],
  );
  const hasUserProjects = useMemo(
    () => (workspace?.projects.some((project) => !isScratchpadProject(project)) ?? false),
    [workspace?.projects],
  );

  // Show discovery modal when pending discovered MCPs exist
  const selectedProject = useMemo(
    () => workspace?.projects.find((p) => p.id === workspace.selectedProjectId),
    [workspace?.projects, workspace?.selectedProjectId],
  );

  const chatToolingSettings = useMemo(
    () => resolveChatToolingSettings(workspace, projectForSession),
    [projectForSession, workspace],
  );

  const hasPendingDiscoveries = useMemo(() => {
    if (!workspace) return false;
    const pendingUser = listPendingDiscoveredMcpServers(workspace.settings.discoveredUserTooling);
    const pendingProject = listPendingDiscoveredMcpServers(selectedProject?.discoveredTooling);
    return pendingUser.length > 0 || pendingProject.length > 0;
  }, [workspace?.settings.discoveredUserTooling, selectedProject?.discoveredTooling]);

  useEffect(() => {
    if (hasPendingDiscoveries) setShowDiscoveryModal(true);
  }, [hasPendingDiscoveries]);

  // Terminal: Ctrl+` toggle + Command palette: Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        setTerminalOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Track terminal running state via exit events
    const offExit = api.onTerminalExit(() => setTerminalRunning(false));

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      offExit();
    };
  }, [api]);

  // Sync terminalHeight from workspace settings when workspace loads
  useEffect(() => {
    if (workspace?.settings.terminalHeight) {
      setTerminalHeight(workspace.settings.terminalHeight);
    }
  }, [workspace?.settings.terminalHeight]);

  const handleTerminalHeightChange = useCallback((newHeight: number) => {
    const clamped = Math.max(MIN_TERMINAL_HEIGHT, Math.round(newHeight));
    setTerminalHeight(clamped);
    void api.setTerminalHeight({ height: clamped });
  }, [api]);

  const handleTerminalClose = useCallback(() => {
    setTerminalOpen(false);
  }, []);

  const handleTerminalToggle = useCallback(() => {
    setTerminalOpen((prev) => !prev);
  }, []);

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

  const projectForSettings = useMemo(
    () => workspace?.projects.find((p) => p.id === projectSettingsId),
    [workspace?.projects, projectSettingsId],
  );

  // Close project settings if the project was removed
  useEffect(() => {
    if (projectSettingsId && !projectForSettings) setProjectSettingsId(undefined);
  }, [projectSettingsId, projectForSettings]);

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
          onSend={(c, attachments, messageMode) => api.sendSessionMessage({
            sessionId: selectedSession.id,
            content: c,
            attachments: attachments?.length ? attachments : undefined,
            messageMode,
          })}
          onCancelTurn={() => { void api.cancelSessionTurn({ sessionId: selectedSession.id }); }}
          onResolveApproval={(approvalId, decision, alwaysApprove) =>
            api.resolveSessionApproval({ sessionId: selectedSession.id, approvalId, decision, alwaysApprove })
          }
          onResolveUserInput={(userInputId, answer, wasFreeform) =>
            api.resolveSessionUserInput({ sessionId: selectedSession.id, userInputId, answer, wasFreeform })
          }
          onSetInteractionMode={(mode) => {
            void api.setSessionInteractionMode({ sessionId: selectedSession.id, mode });
          }}
          onDismissPlanReview={() => {
            void api.dismissSessionPlanReview({ sessionId: selectedSession.id });
          }}
          onDismissMcpAuth={() => {
            void api.dismissSessionMcpAuth({ sessionId: selectedSession.id });
          }}
          onAuthenticateMcp={() => {
            void api.startSessionMcpAuth({ sessionId: selectedSession.id });
          }}
          onUpdateSessionModelConfig={(config) =>
            api.updateSessionModelConfig({
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
          mcpProbingServerIds={workspace.mcpProbingServerIds}
          onTerminalToggle={handleTerminalToggle}
          pattern={patternForSession}
          project={projectForSession}
          runtimeTools={sidecarCapabilities?.runtimeTools}
          session={selectedSession}
          sessionUsage={usageForSession}
          activeSubagents={subagentsForSession}
          terminalOpen={terminalOpen}
          terminalRunning={terminalRunning}
          toolingSettings={chatToolingSettings ?? workspace.settings.tooling}
        />
    );
    detailPanel = (
      <ActivityPanel
        activity={activityForSession}
        onJumpToMessage={jumpToMessage}
        pattern={patternForSession}
        session={selectedSession}
        sessionRequestUsage={requestUsageForSession}
        turnEvents={turnEventsForSession}
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
        onOpenAppDataFolder={() => void api.openAppDataFolder()}
        onResetLocalWorkspace={async () => {
          const fresh = await api.resetLocalWorkspace();
          setWorkspace(fresh);
          setSessionActivities({});
          setShowSettings(false);
        }}
        patterns={workspace.patterns}
        sidecarCapabilities={sidecarCapabilities}
        theme={workspace.settings.theme}
        toolingSettings={workspace.settings.tooling}
        discoveredUserTooling={workspace.settings.discoveredUserTooling}
        onResolveUserDiscoveredTooling={(serverIds, resolution) => {
          void api.resolveWorkspaceDiscoveredTooling({ serverIds, resolution });
        }}
        onGetQuota={() => api.getQuota()}
      />
  ) : null;

  return (
    <>
      <AppShell
        content={content}
        detailPanel={detailPanel}
        overlay={overlay}
        terminalPanel={
          terminalOpen ? (
            <TerminalPanel
              height={terminalHeight}
              onHeightChange={handleTerminalHeightChange}
              onClose={handleTerminalClose}
              onMinimize={handleTerminalClose}
            />
          ) : undefined
        }
        sidebar={
          <Sidebar
            onAddProject={() => void api.addProject()}
            onCreateScratchpad={() => handleCreateScratchpad()}
            onNewProjectSession={(projectId) => {
              setNewSessionProjectId(projectId);
            }}
            onOpenSettings={() => setShowSettings(true)}
            onOpenProjectSettings={(projectId) => setProjectSettingsId(projectId)}
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
            onDeleteSession={(sessionId) => {
              void api.deleteSession({ sessionId });
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

      {showDiscoveryModal && (
        <DiscoveredToolingModal
          onClose={() => setShowDiscoveryModal(false)}
          onResolveProjectServers={(serverIds, resolution) => {
            if (selectedProject) {
              void api.resolveProjectDiscoveredTooling({ projectId: selectedProject.id, serverIds, resolution });
            }
          }}
          onResolveUserServers={(serverIds, resolution) => {
            void api.resolveWorkspaceDiscoveredTooling({ serverIds, resolution });
          }}
          projectDiscoveredTooling={selectedProject?.discoveredTooling}
          projectName={selectedProject?.name}
          userDiscoveredTooling={workspace.settings.discoveredUserTooling}
        />
      )}

      {projectForSettings && (
        <ProjectSettingsPanel
          project={projectForSettings}
          onClose={() => setProjectSettingsId(undefined)}
          onRescanConfigs={() => {
            void api.rescanProjectConfigs({ projectId: projectForSettings.id });
          }}
          onRescanCustomization={() => {
            void api.rescanProjectCustomization({ projectId: projectForSettings.id });
          }}
          onResolveDiscoveredTooling={(serverIds, resolution) => {
            void api.resolveProjectDiscoveredTooling({ projectId: projectForSettings.id, serverIds, resolution });
          }}
          onSetAgentProfileEnabled={(agentProfileId, enabled) => {
            void api.setProjectAgentProfileEnabled({ projectId: projectForSettings.id, agentProfileId, enabled });
          }}
          onRemoveProject={() => {
            void api.removeProject(projectForSettings.id);
            setProjectSettingsId(undefined);
          }}
        />
      )}

      {commandPaletteOpen && workspace && (
        <CommandPalette
          workspace={workspace}
          onClose={() => setCommandPaletteOpen(false)}
          onSelectSession={(sessionId) => {
            void api.selectSession(sessionId);
          }}
          onSelectProject={(projectId) => {
            void api.selectProject(projectId);
          }}
          onNewSession={(projectId) => {
            setNewSessionProjectId(projectId);
          }}
          onCreateScratchpad={handleCreateScratchpad}
          onOpenSettings={() => setShowSettings(true)}
          onOpenProjectSettings={(projectId) => setProjectSettingsId(projectId)}
          onToggleTerminal={handleTerminalToggle}
          onSetTheme={(theme) => void api.setTheme(theme)}
          onDuplicateSession={(sessionId) => {
            void api.duplicateSession({ sessionId });
          }}
          onPinSession={(sessionId, isPinned) => {
            void api.setSessionPinned({ sessionId, isPinned });
          }}
          onArchiveSession={(sessionId, isArchived) => {
            void api.setSessionArchived({ sessionId, isArchived });
          }}
          onAddProject={() => void api.addProject()}
          onOpenAppDataFolder={() => void api.openAppDataFolder()}
        />
      )}
    </>
  );
}
