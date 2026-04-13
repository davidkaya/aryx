import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from '@renderer/components/AppShell';
import { Sidebar } from '@renderer/components/Sidebar';
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
  purgeCompletedActivity,
  type SessionActivityMap,
  type SessionUsageMap,
  type SessionRequestUsageMap,
  type TurnEventLogMap,
} from '@renderer/lib/sessionActivity';
import { applySubagentEvent, pruneSubagentMap, type ActiveSubagentMap } from '@renderer/lib/subagentTracker';
import { applySessionEventWorkspace } from '@renderer/lib/sessionWorkspace';
import { getElectronApi } from '@renderer/lib/electronApi';
import { useTheme, useSidecarCapabilities } from '@renderer/hooks/useAppHooks';
import {
  buildAvailableModelCatalog,
  findModel,
  normalizeWorkflowModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import { listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import { type ReasoningEffort, type WorkflowDefinition } from '@shared/domain/workflow';
import { isScratchpadProject, SCRATCHPAD_PROJECT_ID } from '@shared/domain/project';
import type { ProjectGitFileReference } from '@shared/domain/project';
import { applySessionModelConfig } from '@shared/domain/session';
import type { AppearanceTheme, LspProfileDefinition, McpServerDefinition } from '@shared/domain/tooling';
import { createDefaultQuickPromptSettings, type QuickPromptSettings } from '@shared/domain/tooling';
import type { WorkspaceAgentDefinition } from '@shared/domain/workspaceAgent';
import type { WorkspaceState } from '@shared/domain/workspace';
import type { UpdateStatus } from '@shared/contracts/ipc';
import { createId, nowIso } from '@shared/utils/ids';

// Lazy-loaded components — kept off the critical startup bundle.
// These pull in heavy dependencies (Lexical, @xyflow/react, @xterm/xterm, motion, etc.)
// that are not needed until the user interacts with the corresponding feature.
const ActivityPanel = lazy(() => import('@renderer/components/ActivityPanel').then((m) => ({ default: m.ActivityPanel })));
const BookmarksPanel = lazy(() => import('@renderer/components/BookmarksPanel').then((m) => ({ default: m.BookmarksPanel })));
const BottomPanel = lazy(() => import('@renderer/components/BottomPanel').then((m) => ({ default: m.BottomPanel })));
const ChatPane = lazy(() => import('@renderer/components/ChatPane').then((m) => ({ default: m.ChatPane })));
const CommandPalette = lazy(() => import('@renderer/components/CommandPalette').then((m) => ({ default: m.CommandPalette })));
const CommitComposer = lazy(() => import('@renderer/components/chat/CommitComposer').then((m) => ({ default: m.CommitComposer })));
const DiscoveredToolingModal = lazy(() => import('@renderer/components/DiscoveredToolingModal').then((m) => ({ default: m.DiscoveredToolingModal })));
const GitPanel = lazy(() => import('@renderer/components/GitPanel').then((m) => ({ default: m.GitPanel })));
const KeyboardShortcutsPanel = lazy(() => import('@renderer/components/KeyboardShortcutsPanel').then((m) => ({ default: m.KeyboardShortcutsPanel })));
const ProjectSettingsPanel = lazy(() => import('@renderer/components/ProjectSettingsPanel').then((m) => ({ default: m.ProjectSettingsPanel })));
const SessionSearchPanel = lazy(() => import('@renderer/components/SessionSearchPanel').then((m) => ({ default: m.SessionSearchPanel })));
const SettingsPanel = lazy(() => import('@renderer/components/SettingsPanel').then((m) => ({ default: m.SettingsPanel })));
const TerminalPanel = lazy(() => import('@renderer/components/TerminalPanel').then((m) => ({ default: m.TerminalPanel })));
const WelcomePane = lazy(() => import('@renderer/components/WelcomePane').then((m) => ({ default: m.WelcomePane })));
const WorkflowPicker = lazy(() => import('@renderer/components/workflow/WorkflowPicker').then((m) => ({ default: m.WorkflowPicker })));

// Re-export type-only imports from lazy modules so they're available without pulling in the bundle
type SettingsSection = 'appearance' | 'connection' | 'workflows' | 'agents' | 'mcp-servers' | 'lsp-profiles' | 'quick-prompt' | 'troubleshooting';
type BottomPanelTab = 'terminal' | 'git';

// Constants duplicated from BottomPanel to avoid importing the full module at startup
const DEFAULT_BOTTOM_HEIGHT = 280;
const MIN_BOTTOM_HEIGHT = 120;

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

function createDraftWorkspaceAgent(defaultModelId: string): WorkspaceAgentDefinition {
  const timestamp = nowIso();
  return {
    id: createId('agent'),
    name: '',
    description: '',
    instructions: '',
    model: defaultModelId,
    reasoningEffort: 'high',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createDraftWorkflow(defaultModelId: string, defaultReasoningEffort?: ReasoningEffort): WorkflowDefinition {
  const timestamp = nowIso();
  const startId = createId('wf-start');
  const agentId = createId('wf-agent');
  const endId = createId('wf-end');
  return {
    id: createId('workflow'),
    name: 'New Workflow',
    description: '',
    graph: {
      nodes: [
        { id: startId, kind: 'start', label: 'Start', position: { x: 0, y: 100 }, config: { kind: 'start' } },
        {
          id: agentId,
          kind: 'agent',
          label: 'Primary Agent',
          position: { x: 250, y: 100 },
          config: {
            kind: 'agent',
            id: createId('agent'),
            name: 'Primary Agent',
            description: 'General-purpose assistant.',
            instructions: 'You are a helpful coding assistant working inside the selected project.',
            model: defaultModelId,
            reasoningEffort: defaultReasoningEffort,
          },
        },
        { id: endId, kind: 'end', label: 'End', position: { x: 500, y: 100 }, config: { kind: 'end' } },
      ],
      edges: [
        { id: `edge-${startId}-to-${agentId}`, source: startId, target: agentId, kind: 'direct' },
        { id: `edge-${agentId}-to-${endId}`, source: agentId, target: endId, kind: 'direct' },
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
      maxIterations: 5,
    },
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
  const activityPurgeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [projectSettingsId, setProjectSettingsId] = useState<string>();
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);

  // Workflow picker state — holds the projectId we're creating a session for
  const [workflowPickerProjectId, setWorkflowPickerProjectId] = useState<string | null>(null);

  // Commit composer state
  const [commitComposerCtx, setCommitComposerCtx] = useState<{ projectId: string; sessionId: string; runId?: string }>();

  // Quick prompt settings
  const [quickPromptSettings, setQuickPromptSettings] = useState<QuickPromptSettings>(createDefaultQuickPromptSettings);

  // Bottom panel state (terminal + git)
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('terminal');
  const [bottomPanelHeight, setBottomPanelHeight] = useState(
    () => workspace?.settings.terminalHeight ?? DEFAULT_BOTTOM_HEIGHT,
  );
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [gitDirty, setGitDirty] = useState(false);

  // Load workspace on mount
  useEffect(() => {
    let disposed = false;

    void api
      .loadWorkspace()
      .then((ws) => !disposed && setWorkspace(ws))
      .catch((e) => !disposed && setError(e instanceof Error ? e.message : String(e)));

    void api
      .getQuickPromptSettings()
      .then((s) => !disposed && setQuickPromptSettings(s))
      .catch(() => { /* quick prompt settings unavailable, use defaults */ });

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

      // Schedule purge of completed activity labels after grace period
      if (event.kind === 'status' && event.status === 'idle') {
        const existing = activityPurgeTimers.current.get(event.sessionId);
        if (existing) clearTimeout(existing);
        activityPurgeTimers.current.set(
          event.sessionId,
          setTimeout(() => {
            setSessionActivities((current) => purgeCompletedActivity(current, event.sessionId));
            activityPurgeTimers.current.delete(event.sessionId);
          }, 1500),
        );
      }
      // Cancel pending purge if a new run starts
      if (event.kind === 'status' && event.status === 'running') {
        const existing = activityPurgeTimers.current.get(event.sessionId);
        if (existing) {
          clearTimeout(existing);
          activityPurgeTimers.current.delete(event.sessionId);
        }
      }
    });

    return () => {
      disposed = true;
      offWorkspace();
      offSessionEvent();
      for (const timer of activityPurgeTimers.current.values()) clearTimeout(timer);
      activityPurgeTimers.current.clear();
    };
  }, [api]);

  // Subscribe to auto-update status pushes from the main process
  useEffect(() => {
    const off = api.onUpdateStatus((status) => setUpdateStatus(status));
    return off;
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
  const workflowForSession = useMemo(() => {
    if (!selectedSession) {
      return undefined;
    }

    const baseWorkflow = workspace?.workflows.find((workflow) => workflow.id === selectedSession.workflowId);
    if (!baseWorkflow) {
      return undefined;
    }

    const workflowWithSessionConfig =
      projectForSession && selectedSession.sessionModelConfig
        ? applySessionModelConfig(baseWorkflow, selectedSession)
        : baseWorkflow;

    return normalizeWorkflowModels(workflowWithSessionConfig, availableModels);
  }, [availableModels, projectForSession, selectedSession, workspace?.workflows]);
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

  // Keep refs for values the keyboard handler reads — avoids re-registering on every render.
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const showSettingsRef = useRef(showSettings);
  showSettingsRef.current = showSettings;
  const showShortcutsRef = useRef(showShortcuts);
  showShortcutsRef.current = showShortcuts;
  const commandPaletteOpenRef = useRef(commandPaletteOpen);
  commandPaletteOpenRef.current = commandPaletteOpen;
  const projectSettingsIdRef = useRef(projectSettingsId);
  projectSettingsIdRef.current = projectSettingsId;

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const ws = workspaceRef.current;

      // Ignore keyboard shortcuts while typing in inputs (except our global combos)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable;

      // ── Ctrl+` — Toggle terminal ──
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        handleTerminalToggle();
        return;
      }

      // ── Ctrl/Cmd+K — Command palette ──
      if (mod && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      // ── Ctrl/Cmd+/ — Keyboard shortcuts cheat sheet ──
      if (mod && e.key === '/') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }

      // ── Ctrl/Cmd+Shift+F — Search sessions ──
      if (mod && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
        return;
      }

      // ── Ctrl/Cmd+Shift+B — Bookmarks ──
      if (mod && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        setShowBookmarks((prev) => !prev);
        return;
      }

      // ── Ctrl/Cmd+, — Open settings ──
      if (mod && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
        return;
      }

      // ── Escape — Close overlays or cancel running turn ──
      if (e.key === 'Escape') {
        // Close overlays in priority order (command palette and shortcuts use their own capture listeners)
        if (projectSettingsIdRef.current) {
          e.preventDefault();
          setProjectSettingsId(undefined);
          return;
        }
        if (showSettingsRef.current) {
          e.preventDefault();
          setShowSettings(false);
          return;
        }

        // If nothing is open, cancel a running turn on the selected session
        if (ws) {
          const session = ws.sessions.find((s) => s.id === ws.selectedSessionId);
          if (session?.status === 'running' && !isInput) {
            e.preventDefault();
            void api.cancelSessionTurn({ sessionId: session.id });
            return;
          }
        }
        return;
      }

      // Skip remaining shortcuts when focus is in an input field
      if (isInput) return;

      // ── Ctrl/Cmd+N — New session ──
      if (mod && e.key === 'n') {
        e.preventDefault();
        if (ws) {
          const defaultProjectId =
            ws.selectedProjectId ??
            ws.projects.find((p) => !isScratchpadProject(p))?.id;
          if (defaultProjectId) {
            if (ws.workflows.length <= 1) {
              const wf = ws.workflows[0];
              if (wf) void api.createSession({ projectId: defaultProjectId, workflowId: wf.id });
            } else {
              setWorkflowPickerProjectId(defaultProjectId);
            }
          }
        }
        return;
      }

      // ── Ctrl/Cmd+W — Archive / close current session ──
      if (mod && e.key === 'w') {
        e.preventDefault();
        if (ws?.selectedSessionId) {
          void api.setSessionArchived({ sessionId: ws.selectedSessionId, isArchived: true });
        }
        return;
      }

      // ── Ctrl+Tab / Ctrl+Shift+Tab — Cycle sessions ──
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        if (ws) {
          const activeSessions = ws.sessions.filter((s) => !s.isArchived);
          if (activeSessions.length > 1) {
            const currentIdx = activeSessions.findIndex((s) => s.id === ws.selectedSessionId);
            const direction = e.shiftKey ? -1 : 1;
            const nextIdx = (currentIdx + direction + activeSessions.length) % activeSessions.length;
            void api.selectSession(activeSessions[nextIdx].id);
          }
        }
        return;
      }

      // ── Ctrl/Cmd+. — Quick approve pending tool call ──
      if (mod && e.key === '.') {
        e.preventDefault();
        if (ws?.selectedSessionId) {
          const session = ws.sessions.find((s) => s.id === ws.selectedSessionId);
          if (session?.pendingApproval?.status === 'pending') {
            void api.resolveSessionApproval({
              sessionId: session.id,
              approvalId: session.pendingApproval.id,
              decision: 'approved',
            });
          }
        }
        return;
      }

      // ── Ctrl/Cmd+L — Focus the composer ──
      if (mod && e.key === 'l') {
        e.preventDefault();
        const editor = document.querySelector<HTMLElement>('.markdown-composer-editable');
        editor?.focus();
        return;
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

  // Sync bottom panel height from workspace settings when workspace loads
  useEffect(() => {
    if (workspace?.settings.terminalHeight) {
      setBottomPanelHeight(workspace.settings.terminalHeight);
    }
  }, [workspace?.settings.terminalHeight]);

  const handleBottomPanelHeightChange = useCallback((newHeight: number) => {
    const clamped = Math.max(MIN_BOTTOM_HEIGHT, Math.round(newHeight));
    setBottomPanelHeight(clamped);
    void api.setTerminalHeight({ height: clamped });
  }, [api]);

  const handleBottomPanelClose = useCallback(() => {
    setBottomPanelOpen(false);
  }, []);

  const handleTerminalToggle = useCallback(() => {
    setBottomPanelOpen((prev) => {
      if (prev && bottomPanelTab === 'terminal') return false;
      return true;
    });
    setBottomPanelTab('terminal');
  }, [bottomPanelTab]);

  const handleGitToggle = useCallback(() => {
    setBottomPanelOpen((prev) => {
      if (prev && bottomPanelTab === 'git') return false;
      return true;
    });
    setBottomPanelTab('git');
  }, [bottomPanelTab]);

  const jumpToMessage = useCallback((messageId: string) => {
    const element = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('ring-1', 'ring-indigo-500/40', 'rounded-lg');
      setTimeout(() => element.classList.remove('ring-1', 'ring-indigo-500/40', 'rounded-lg'), 1500);
    }
  }, []);

  const handleDiscardRunChanges = useCallback(
    (sessionId: string, runId: string, files?: ProjectGitFileReference[]) =>
      api.discardSessionRunGitChanges({ sessionId, runId, files }),
    [api],
  );

  const handleOpenCommitComposer = useCallback(() => {
    if (!selectedSession) return;
    setCommitComposerCtx({
      projectId: selectedSession.projectId,
      sessionId: selectedSession.id,
    });
  }, [selectedSession]);

  const handleCreateScratchpad = useCallback(() => {
    if (!workspace) return;
    if (workspace.workflows.length <= 1) {
      const wf = workspace.workflows[0];
      if (wf) void api.createSession({ projectId: SCRATCHPAD_PROJECT_ID, workflowId: wf.id });
      return;
    }
    setWorkflowPickerProjectId(SCRATCHPAD_PROJECT_ID);
  }, [api, workspace]);

  /** Opens the workflow picker, or creates immediately if ≤1 workflow. */
  const handleNewSession = useCallback((projectId: string) => {
    if (!workspace) return;
    if (workspace.workflows.length <= 1) {
      const wf = workspace.workflows[0];
      if (wf) void api.createSession({ projectId, workflowId: wf.id });
      return;
    }
    setWorkflowPickerProjectId(projectId);
  }, [api, workspace]);

  /** Called when a workflow is picked from the picker. */
  const handleWorkflowPicked = useCallback((workflowId: string) => {
    if (!workflowPickerProjectId) return;
    void api.createSession({ projectId: workflowPickerProjectId, workflowId });
    setWorkflowPickerProjectId(null);
  }, [api, workflowPickerProjectId]);

  const handleOpenSettingsAt = useCallback((section?: SettingsSection) => {
    setSettingsSection(section);
    setShowSettings(true);
  }, []);

  const handleInstallUpdate = useCallback(() => {
    void api.installUpdate();
  }, [api]);

  // Listen for tray "Quick Scratchpad" action
  const scratchpadRef = useRef(handleCreateScratchpad);
  scratchpadRef.current = handleCreateScratchpad;
  useEffect(() => {
    return api.onTrayCreateScratchpad(() => scratchpadRef.current());
  }, [api]);

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

  // Suspense fallback for lazy-loaded panels — intentionally blank to avoid layout flash
  const lazyFallback = null;

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
  } else if (selectedSession && workflowForSession && projectForSession) {
    content = (
      <Suspense fallback={lazyFallback}>
        <ChatPane
          onSend={(c, attachments, messageMode, promptInvocation) => api.sendSessionMessage({
            sessionId: selectedSession.id,
            content: c,
            attachments: attachments?.length ? attachments : undefined,
            messageMode,
            promptInvocation,
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
          onBranchFromMessage={(messageId) => {
            void api.branchSession({ sessionId: selectedSession.id, messageId });
          }}
          onPinMessage={(messageId, isPinned) => {
            void api.setSessionMessagePinned({ sessionId: selectedSession.id, messageId, isPinned });
          }}
          onRegenerateMessage={(messageId) => {
            void api.regenerateSessionMessage({ sessionId: selectedSession.id, messageId });
          }}
          onEditAndResendMessage={(messageId, content) => {
            void api.editAndResendSessionMessage({ sessionId: selectedSession.id, messageId, content });
          }}
          branchOriginLabel={
            selectedSession.branchOrigin
              ? workspace.sessions.find((s) => s.id === selectedSession.branchOrigin!.sourceSessionId)?.title
              : undefined
          }
          availableModels={availableModels}
          mcpProbingServerIds={workspace.mcpProbingServerIds}
          onTerminalToggle={handleTerminalToggle}
          onGitToggle={!isScratchpadProject(selectedSession.projectId) ? handleGitToggle : undefined}
          workflow={workflowForSession}
          project={projectForSession}
          runtimeTools={sidecarCapabilities?.runtimeTools}
          session={selectedSession}
          sessionUsage={usageForSession}
          sessionActivity={activityForSession}
          activeSubagents={subagentsForSession}
          terminalOpen={bottomPanelOpen && bottomPanelTab === 'terminal'}
          terminalRunning={terminalRunning}
          gitPanelOpen={bottomPanelOpen && bottomPanelTab === 'git'}
          gitDirty={gitDirty}
          toolingSettings={chatToolingSettings ?? workspace.settings.tooling}
          onDiscardRunChanges={handleDiscardRunChanges}
          onOpenCommitComposer={handleOpenCommitComposer}
        />
      </Suspense>
    );
    detailPanel = (
      <Suspense fallback={lazyFallback}>
        <ActivityPanel
          activity={activityForSession}
          workflow={workflowForSession}
          workflows={workspace?.workflows}
          session={selectedSession}
          sessionRequestUsage={requestUsageForSession}
          turnEvents={turnEventsForSession}
        />
      </Suspense>
    );
  } else {
    content = (
      <Suspense fallback={lazyFallback}>
        <WelcomePane
          hasProjects={hasUserProjects}
          connectionStatus={sidecarCapabilities?.connection.status}
          onAddProject={() => void api.addProject()}
          onNewScratchpad={() => handleCreateScratchpad()}
          onOpenSettings={() => setShowSettings(true)}
        />
      </Suspense>
    );
  }

  // Settings overlay
  const overlay = showSettings ? (
    <Suspense fallback={lazyFallback}>
      <SettingsPanel
        availableModels={availableModels}
        initialSection={settingsSection}
        isRefreshingCapabilities={isRefreshingCapabilities}
        onClose={() => { setShowSettings(false); setSettingsSection(undefined); }}
        onDeleteLspProfile={async (id) => {
          await api.deleteLspProfile(id);
        }}
        onDeleteMcpServer={async (id) => {
          await api.deleteMcpServer(id);
        }}
        onDeleteWorkflow={async (id) => {
          await api.deleteWorkflow(id);
        }}
        onNewLspProfile={createDraftLspProfile}
        onNewMcpServer={createDraftMcpServer}
        onNewWorkflow={() => {
          const defaultModel = availableModels[0] ?? findModel('gpt-5.4', availableModels) ?? findModel('gpt-5.4');
          return createDraftWorkflow(
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
        onSaveWorkflow={async (workflow) => {
          await api.saveWorkflow({ workflow });
        }}
        onSaveWorkspaceAgent={async (agent) => {
          await api.saveWorkspaceAgent({ agent });
        }}
        onDeleteWorkspaceAgent={async (id) => {
          await api.deleteWorkspaceAgent(id);
        }}
        onNewWorkspaceAgent={() => {
          const defaultModel = availableModels[0] ?? findModel('gpt-5.4', availableModels) ?? findModel('gpt-5.4');
          return createDraftWorkspaceAgent(defaultModel?.id ?? 'gpt-5.4');
        }}
        workspaceAgents={workspace.settings.agents ?? []}
        onSetTheme={(theme) => void api.setTheme(theme)}
        notificationsEnabled={workspace.settings.notificationsEnabled !== false}
        onSetNotificationsEnabled={(enabled) => void api.setNotificationsEnabled(enabled)}
        minimizeToTray={workspace.settings.minimizeToTray === true}
        onSetMinimizeToTray={(enabled) => void api.setMinimizeToTray(enabled)}
        gitAutoRefreshEnabled={workspace.settings.gitAutoRefreshEnabled !== false}
        onSetGitAutoRefreshEnabled={(enabled) => void api.setGitAutoRefreshEnabled(enabled)}
        onOpenAppDataFolder={() => void api.openAppDataFolder()}
        onResetLocalWorkspace={async () => {
          const fresh = await api.resetLocalWorkspace();
          setWorkspace(fresh);
          setSessionActivities({});
          setShowSettings(false);
        }}
        workflows={workspace.workflows}
        workflowTemplates={workspace.workflowTemplates}
        onCreateWorkflowFromTemplate={async (templateId, name) => {
          await api.createWorkflowFromTemplate({ templateId, options: name ? { name } : undefined });
        }}
        sidecarCapabilities={sidecarCapabilities}
        theme={workspace.settings.theme}
        toolingSettings={workspace.settings.tooling}
        discoveredUserTooling={workspace.settings.discoveredUserTooling}
        onResolveUserDiscoveredTooling={(serverIds, resolution) => {
          void api.resolveWorkspaceDiscoveredTooling({ serverIds, resolution });
        }}
        onGetQuota={() => api.getQuota()}
        quickPromptSettings={quickPromptSettings}
        onSetQuickPromptSettings={(patch) => {
          const updated = { ...quickPromptSettings, ...patch };
          setQuickPromptSettings(updated);
          void api.setQuickPromptSettings(patch);
        }}
      />
    </Suspense>
  ) : null;

  return (
    <>
      <AppShell
        content={content}
        detailPanel={detailPanel}
        overlay={overlay}
        bottomPanel={
          bottomPanelOpen ? (
            <Suspense fallback={lazyFallback}>
              <BottomPanel
                activeTab={bottomPanelTab}
                gitContent={
                  selectedSession && !isScratchpadProject(selectedSession.projectId) ? (
                    <GitPanel
                      onDirtyChange={setGitDirty}
                      projectId={selectedSession.projectId}
                    />
                  ) : (
                    <div className="flex items-center justify-center py-8 text-[11px] text-[var(--color-text-muted)]">
                      Git is not available for scratchpad sessions
                    </div>
                  )
                }
                gitDirty={gitDirty}
                height={bottomPanelHeight}
                onClose={handleBottomPanelClose}
                onHeightChange={handleBottomPanelHeightChange}
                onTabChange={setBottomPanelTab}
                showGitTab={!!selectedSession && !isScratchpadProject(selectedSession.projectId)}
                terminalContent={<TerminalPanel onRunningChange={setTerminalRunning} />}
                terminalRunning={terminalRunning}
              />
            </Suspense>
          ) : undefined
        }
        sidebar={
          <Sidebar
            onAddProject={() => void api.addProject()}
            onCreateScratchpad={() => handleCreateScratchpad()}
            onNewProjectSession={(projectId) => handleNewSession(projectId)}
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
            updateStatus={updateStatus}
            onViewUpdateDetails={() => handleOpenSettingsAt('troubleshooting')}
            onInstallUpdate={handleInstallUpdate}
            workspace={workspace}
          />
        }
      />

      {showDiscoveryModal && (
        <Suspense fallback={lazyFallback}>
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
        </Suspense>
      )}

      {projectForSettings && (
        <Suspense fallback={lazyFallback}>
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
        </Suspense>
      )}

      {commandPaletteOpen && workspace && (
        <Suspense fallback={lazyFallback}>
          <CommandPalette
            workspace={workspace}
            onClose={() => setCommandPaletteOpen(false)}
            onSelectSession={(sessionId) => {
              void api.selectSession(sessionId);
            }}
            onSelectProject={(projectId) => {
              void api.selectProject(projectId);
            }}
            onNewSession={(projectId) => handleNewSession(projectId)}
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
            onShowShortcuts={() => setShowShortcuts(true)}
            onShowSearch={() => setShowSearch(true)}
            onShowBookmarks={() => setShowBookmarks(true)}
          />
        </Suspense>
      )}

      {showShortcuts && (
        <Suspense fallback={lazyFallback}>
          <KeyboardShortcutsPanel onClose={() => setShowShortcuts(false)} />
        </Suspense>
      )}

      {showSearch && workspace && (
        <Suspense fallback={lazyFallback}>
          <SessionSearchPanel
            workspace={workspace}
            onClose={() => setShowSearch(false)}
            onSelectSession={(sessionId) => {
              void api.selectSession(sessionId);
            }}
          />
        </Suspense>
      )}

      {showBookmarks && workspace && (
        <Suspense fallback={lazyFallback}>
          <BookmarksPanel
            workspace={workspace}
            onClose={() => setShowBookmarks(false)}
            onSelectSession={(sessionId) => {
              void api.selectSession(sessionId);
            }}
            onUnpinMessage={(sessionId, messageId) => {
              void api.setSessionMessagePinned({ sessionId, messageId, isPinned: false });
            }}
          />
        </Suspense>
      )}

      {commitComposerCtx && (
        <Suspense fallback={lazyFallback}>
          <CommitComposer
            onClose={() => setCommitComposerCtx(undefined)}
            projectId={commitComposerCtx.projectId}
            runId={commitComposerCtx.runId}
            sessionId={commitComposerCtx.sessionId}
          />
        </Suspense>
      )}

      {workflowPickerProjectId && workspace && (
        <Suspense fallback={lazyFallback}>
          <WorkflowPicker
            workflows={workspace.workflows}
            onSelect={handleWorkflowPicked}
            onClose={() => setWorkflowPickerProjectId(null)}
          />
        </Suspense>
      )}
    </>
  );
}
