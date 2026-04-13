import electron from 'electron';
import type { BrowserWindow } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type {
  BranchSessionInput,
  CancelSessionTurnInput,
  CommitProjectGitChangesInput,
  CreateSessionInput,
  CreateWorkflowFromTemplateInput,
  CreateWorkflowSessionInput,
  CreateProjectGitBranchInput,
  DismissSessionMcpAuthInput,
  DismissSessionPlanReviewInput,
  DeleteProjectGitBranchInput,
  DeleteSessionInput,
  DiscardSessionRunGitChangesInput,
  EditAndResendSessionMessageInput,
  ExportWorkflowInput,
  ImportWorkflowInput,
  ProjectGitDetailsInput,
  ProjectGitFilePreviewInput,
  ProjectGitFileSelectionInput,
  ProjectGitInput,
  PullProjectGitInput,
  RegenerateSessionMessageInput,
  ResolveWorkspaceDiscoveredToolingInput,
  StartSessionMcpAuthInput,
  SuggestProjectGitCommitMessageInput,
  SwitchProjectGitBranchInput,
  DuplicateSessionInput,
  RenameSessionInput,
  RescanProjectConfigsInput,
  RescanProjectCustomizationInput,
  ResolveProjectDiscoveredToolingInput,
  ResolveSessionApprovalInput,
  ResolveSessionUserInputInput,
  SaveLspProfileInput,
  SaveMcpServerInput,
  SaveWorkflowInput,
  SaveWorkflowTemplateInput,
  SaveWorkspaceAgentInput,
  SendSessionMessageInput,
  SetProjectAgentProfileEnabledInput,
  SetSessionArchivedInput,
  SetSessionInteractionModeInput,
  SetSessionMessagePinnedInput,
  SetSessionPinnedInput,
  SetTerminalHeightInput,
  ResizeTerminalInput,
  UpdateSessionModelConfigInput,
  UpdateSessionApprovalSettingsInput,
  UpdateSessionToolingInput,
  QuickPromptSendInput,
} from '@shared/contracts/ipc';
import type { QuerySessionsInput } from '@shared/domain/sessionLibrary';
import type { AppearanceTheme, QuickPromptSettings } from '@shared/domain/tooling';

import { AryxAppService } from '@main/AryxAppService';
import { AutoUpdateService } from '@main/services/autoUpdater';
import { createDesktopNotificationHandler } from '@main/services/desktopNotifications';
import { applyTitleBarTheme } from '@main/windows/titleBarTheme';
import { hideQuickPromptWindow } from '@main/windows/createQuickPromptWindow';
import { buildAvailableModelCatalog } from '@shared/domain/models';
import { SCRATCHPAD_PROJECT_ID } from '@shared/domain/project';
import type { UpdateStatus } from '@shared/contracts/ipc';

const { ipcMain } = electron;

export function registerIpcHandlers(
  window: BrowserWindow,
  service: AryxAppService,
  autoUpdateService: AutoUpdateService,
  quickPromptWindow?: BrowserWindow,
): void {
  window.on('focus', () => {
    if (service.isGitAutoRefreshEnabled()) {
      service.scheduleProjectGitRefresh();
    }
  });

  ipcMain.handle(ipcChannels.describeSidecarCapabilities, () => service.describeSidecarCapabilities());
  ipcMain.handle(ipcChannels.refreshSidecarCapabilities, () => service.refreshSidecarCapabilities());
  ipcMain.handle(ipcChannels.loadWorkspace, () => service.loadWorkspace());
  ipcMain.handle(ipcChannels.addProject, () => service.addProject());
  ipcMain.handle(ipcChannels.removeProject, (_event, projectId: string) => service.removeProject(projectId));
  ipcMain.handle(
    ipcChannels.resolveWorkspaceDiscoveredTooling,
    (_event, input: ResolveWorkspaceDiscoveredToolingInput) =>
      service.resolveWorkspaceDiscoveredTooling(input.serverIds, input.resolution),
  );
  ipcMain.handle(ipcChannels.refreshProjectGitContext, (_event, projectId?: string) =>
    service.refreshProjectGitContext(projectId),
  );
  ipcMain.handle(ipcChannels.getProjectGitDetails, (_event, input: ProjectGitDetailsInput) =>
    service.getProjectGitDetails(input.projectId, input.commitLimit),
  );
  ipcMain.handle(ipcChannels.getProjectGitFilePreview, (_event, input: ProjectGitFilePreviewInput) =>
    service.getProjectGitFilePreview(input.projectId, input.file),
  );
  ipcMain.handle(ipcChannels.rescanProjectConfigs, (_event, input: RescanProjectConfigsInput) =>
    service.rescanProjectConfigs(input.projectId),
  );
  ipcMain.handle(
    ipcChannels.rescanProjectCustomization,
    (_event, input: RescanProjectCustomizationInput) =>
      service.rescanProjectCustomization(input.projectId),
  );
  ipcMain.handle(
    ipcChannels.resolveProjectDiscoveredTooling,
    (_event, input: ResolveProjectDiscoveredToolingInput) =>
      service.resolveProjectDiscoveredTooling(input.projectId, input.serverIds, input.resolution),
  );
  ipcMain.handle(
    ipcChannels.setProjectAgentProfileEnabled,
    (_event, input: SetProjectAgentProfileEnabledInput) =>
      service.setProjectAgentProfileEnabled(input.projectId, input.agentProfileId, input.enabled),
  );
  ipcMain.handle(ipcChannels.saveWorkflow, (_event, input: SaveWorkflowInput) => service.saveWorkflow(input.workflow));
  ipcMain.handle(ipcChannels.saveWorkflowTemplate, (_event, input: SaveWorkflowTemplateInput) =>
    service.saveWorkflowTemplate(input.workflowId, input.options),
  );
  ipcMain.handle(ipcChannels.deleteWorkflow, (_event, workflowId: string) => service.deleteWorkflow(workflowId));
  ipcMain.handle(ipcChannels.listWorkflowReferences, (_event, workflowId: string) =>
    service.listWorkflowReferences(workflowId),
  );
  ipcMain.handle(ipcChannels.createWorkflowFromTemplate, (_event, input: CreateWorkflowFromTemplateInput) =>
    service.createWorkflowFromTemplate(input.templateId, input.options),
  );
  ipcMain.handle(ipcChannels.exportWorkflow, (_event, input: ExportWorkflowInput) =>
    service.exportWorkflow(input.workflowId, input.format),
  );
  ipcMain.handle(ipcChannels.importWorkflow, (_event, input: ImportWorkflowInput) =>
    service.importWorkflow(input.content, input.format, input.options),
  );
  ipcMain.handle(ipcChannels.setTheme, async (_event, theme: AppearanceTheme) => {
    const result = await service.setTheme(theme);
    applyTitleBarTheme(window, theme);
    return result;
  });
  ipcMain.handle(
    ipcChannels.setTerminalHeight,
    (_event, input: SetTerminalHeightInput) => service.setTerminalHeight(input.height),
  );
  ipcMain.handle(
    ipcChannels.setNotificationsEnabled,
    (_event, enabled: boolean) => service.setNotificationsEnabled(enabled),
  );
  ipcMain.handle(
    ipcChannels.setMinimizeToTray,
    (_event, enabled: boolean) => service.setMinimizeToTray(enabled),
  );
  ipcMain.handle(
    ipcChannels.setGitAutoRefreshEnabled,
    (_event, enabled: boolean) => service.setGitAutoRefreshEnabled(enabled),
  );
  ipcMain.handle(ipcChannels.checkForUpdates, () => autoUpdateService.checkForUpdates());
  ipcMain.handle(ipcChannels.installUpdate, () => {
    autoUpdateService.installUpdate();
  });
  ipcMain.handle(ipcChannels.saveMcpServer, (_event, input: SaveMcpServerInput) =>
    service.saveMcpServer(input.server),
  );
  ipcMain.handle(ipcChannels.deleteMcpServer, (_event, serverId: string) =>
    service.deleteMcpServer(serverId),
  );
  ipcMain.handle(ipcChannels.saveLspProfile, (_event, input: SaveLspProfileInput) =>
    service.saveLspProfile(input.profile),
  );
  ipcMain.handle(ipcChannels.deleteLspProfile, (_event, profileId: string) =>
    service.deleteLspProfile(profileId),
  );
  ipcMain.handle(ipcChannels.saveWorkspaceAgent, (_event, input: SaveWorkspaceAgentInput) =>
    service.saveWorkspaceAgent(input.agent),
  );
  ipcMain.handle(ipcChannels.deleteWorkspaceAgent, (_event, agentId: string) =>
    service.deleteWorkspaceAgent(agentId),
  );
  ipcMain.handle(ipcChannels.describeTerminal, () => service.describeTerminal());
  ipcMain.handle(ipcChannels.createTerminal, () => service.createTerminal());
  ipcMain.handle(ipcChannels.restartTerminal, () => service.restartTerminal());
  ipcMain.handle(ipcChannels.killTerminal, () => service.killTerminal());
  ipcMain.on(ipcChannels.writeTerminal, (_event, data: string) => {
    service.writeTerminal(data);
  });
  ipcMain.on(ipcChannels.resizeTerminal, (_event, input: ResizeTerminalInput) => {
    service.resizeTerminal(input.cols, input.rows);
  });
  ipcMain.handle(ipcChannels.updateSessionTooling, (_event, input: UpdateSessionToolingInput) =>
    service.updateSessionTooling(
      input.sessionId,
      input.enabledMcpServerIds,
      input.enabledLspProfileIds,
    ),
  );
  ipcMain.handle(
    ipcChannels.updateSessionApprovalSettings,
    (_event, input: UpdateSessionApprovalSettingsInput) =>
      service.updateSessionApprovalSettings(input.sessionId, input.autoApprovedToolNames),
  );
  ipcMain.handle(ipcChannels.createSession, (_event, input: CreateSessionInput) =>
    service.createSession(input.projectId, input.workflowId),
  );
  ipcMain.handle(ipcChannels.createWorkflowSession, (_event, input: CreateWorkflowSessionInput) =>
    service.createWorkflowSession(input.projectId, input.workflowId),
  );
  ipcMain.handle(ipcChannels.duplicateSession, (_event, input: DuplicateSessionInput) =>
    service.duplicateSession(input.sessionId),
  );
  ipcMain.handle(ipcChannels.branchSession, (_event, input: BranchSessionInput) =>
    service.branchSession(input.sessionId, input.messageId),
  );
  ipcMain.handle(ipcChannels.setSessionMessagePinned, (_event, input: SetSessionMessagePinnedInput) =>
    service.setSessionMessagePinned(input.sessionId, input.messageId, input.isPinned),
  );
  ipcMain.handle(ipcChannels.renameSession, (_event, input: RenameSessionInput) =>
    service.renameSession(input.sessionId, input.title),
  );
  ipcMain.handle(ipcChannels.setSessionPinned, (_event, input: SetSessionPinnedInput) =>
    service.setSessionPinned(input.sessionId, input.isPinned),
  );
  ipcMain.handle(ipcChannels.setSessionArchived, (_event, input: SetSessionArchivedInput) =>
    service.setSessionArchived(input.sessionId, input.isArchived),
  );
  ipcMain.handle(ipcChannels.deleteSession, (_event, input: DeleteSessionInput) =>
    service.deleteSession(input.sessionId),
  );
  ipcMain.handle(ipcChannels.regenerateSessionMessage, (_event, input: RegenerateSessionMessageInput) =>
    service.regenerateSessionMessage(input.sessionId, input.messageId),
  );
  ipcMain.handle(ipcChannels.editAndResendSessionMessage, (_event, input: EditAndResendSessionMessageInput) =>
    service.editAndResendSessionMessage(input.sessionId, input.messageId, input.content, input.attachments),
  );
  ipcMain.handle(ipcChannels.sendSessionMessage, (_event, input: SendSessionMessageInput) =>
    service.sendSessionMessage(
      input.sessionId,
      input.content,
      input.attachments,
      input.messageMode,
      input.promptInvocation,
    ),
  );
  ipcMain.handle(ipcChannels.cancelSessionTurn, (_event, input: CancelSessionTurnInput) =>
    service.cancelSessionTurn(input.sessionId),
  );
  ipcMain.handle(ipcChannels.resolveSessionApproval, (_event, input: ResolveSessionApprovalInput) =>
    service.resolveSessionApproval(input.sessionId, input.approvalId, input.decision, input.alwaysApprove),
  );
  ipcMain.handle(ipcChannels.resolveSessionUserInput, (_event, input: ResolveSessionUserInputInput) =>
    service.resolveSessionUserInput(input.sessionId, input.userInputId, input.answer, input.wasFreeform),
  );
  ipcMain.handle(ipcChannels.setSessionInteractionMode, (_event, input: SetSessionInteractionModeInput) =>
    service.setSessionInteractionMode(input.sessionId, input.mode),
  );
  ipcMain.handle(ipcChannels.dismissSessionPlanReview, (_event, input: DismissSessionPlanReviewInput) =>
    service.dismissSessionPlanReview(input.sessionId),
  );
  ipcMain.handle(ipcChannels.dismissSessionMcpAuth, (_event, input: DismissSessionMcpAuthInput) =>
    service.dismissSessionMcpAuth(input.sessionId),
  );
  ipcMain.handle(ipcChannels.startSessionMcpAuth, (_event, input: StartSessionMcpAuthInput) =>
    service.startSessionMcpAuth(input.sessionId),
  );
  ipcMain.handle(
    ipcChannels.discardSessionRunGitChanges,
    (_event, input: DiscardSessionRunGitChangesInput) =>
      service.discardSessionRunGitChanges(input.sessionId, input.runId, input.files),
  );
  ipcMain.handle(
    ipcChannels.suggestProjectGitCommitMessage,
    (_event, input: SuggestProjectGitCommitMessageInput) =>
      service.suggestProjectGitCommitMessage(input.sessionId, input.runId, input.conventionalType),
  );
  ipcMain.handle(
    ipcChannels.updateSessionModelConfig,
    (_event, input: UpdateSessionModelConfigInput) =>
      service.updateSessionModelConfig(input.sessionId, input.model, input.reasoningEffort),
  );
  ipcMain.handle(
    ipcChannels.stageProjectGitFiles,
    (_event, input: ProjectGitFileSelectionInput) => service.stageProjectGitFiles(input.projectId, input.files),
  );
  ipcMain.handle(
    ipcChannels.unstageProjectGitFiles,
    (_event, input: ProjectGitFileSelectionInput) => service.unstageProjectGitFiles(input.projectId, input.files),
  );
  ipcMain.handle(
    ipcChannels.commitProjectGitChanges,
    (_event, input: CommitProjectGitChangesInput) =>
      service.commitProjectGitChanges(input.projectId, input.message, input.files, input.push),
  );
  ipcMain.handle(ipcChannels.pushProjectGit, (_event, input: ProjectGitInput) =>
    service.pushProjectGit(input.projectId),
  );
  ipcMain.handle(ipcChannels.fetchProjectGit, (_event, input: ProjectGitInput) =>
    service.fetchProjectGit(input.projectId),
  );
  ipcMain.handle(ipcChannels.pullProjectGit, (_event, input: PullProjectGitInput) =>
    service.pullProjectGit(input.projectId, input.rebase),
  );
  ipcMain.handle(
    ipcChannels.createProjectGitBranch,
    (_event, input: CreateProjectGitBranchInput) =>
      service.createProjectGitBranch(input.projectId, input.name, input.startPoint, input.checkout),
  );
  ipcMain.handle(
    ipcChannels.switchProjectGitBranch,
    (_event, input: SwitchProjectGitBranchInput) =>
      service.switchProjectGitBranch(input.projectId, input.name),
  );
  ipcMain.handle(
    ipcChannels.deleteProjectGitBranch,
    (_event, input: DeleteProjectGitBranchInput) =>
      service.deleteProjectGitBranch(input.projectId, input.name, input.force),
  );
  ipcMain.handle(ipcChannels.querySessions, (_event, input: QuerySessionsInput) => service.querySessions(input));
  ipcMain.handle(ipcChannels.selectProject, (_event, projectId?: string) => service.selectProject(projectId));
  ipcMain.handle(ipcChannels.selectSession, (_event, sessionId?: string) => service.selectSession(sessionId));
  ipcMain.handle(ipcChannels.openAppDataFolder, () => service.openAppDataFolder());
  ipcMain.handle(ipcChannels.resetLocalWorkspace, () => service.resetLocalWorkspace());
  ipcMain.handle(ipcChannels.getQuota, () => service.getQuota());

  service.on('workspace-updated', (workspace) => {
    window.webContents.send(ipcChannels.workspaceUpdated, workspace);
  });

  service.on('session-event', (event) => {
    window.webContents.send(ipcChannels.sessionEvent, event);
  });

  // Desktop notifications for run completion, failure, and approval requests
  const handleNotification = createDesktopNotificationHandler(
    () => window,
    () => service.getCachedWorkspace(),
    (sessionId) => service.selectSession(sessionId),
  );
  service.on('session-event', handleNotification);

  const sendUpdateStatus = (status: UpdateStatus) => {
    if (!window.isDestroyed()) {
      window.webContents.send(ipcChannels.updateStatus, status);
    }
  };
  autoUpdateService.onStatus(sendUpdateStatus);
  window.webContents.on('did-finish-load', () => {
    sendUpdateStatus(autoUpdateService.getStatus());
  });

  service.on('terminal-data', (data) => {
    window.webContents.send(ipcChannels.terminalData, data);
  });

  service.on('terminal-exit', (info) => {
    window.webContents.send(ipcChannels.terminalExit, info);
  });

  // --- Quick Prompt IPC ---

  // Track the active quick prompt session so events can be routed
  let quickPromptSessionId: string | undefined;

  ipcMain.handle(ipcChannels.quickPromptSend, async (_event, input: QuickPromptSendInput) => {
    const workspace = await service.loadWorkspace();
    const workflowId = workspace.selectedWorkflowId ?? workspace.workflows[0]?.id;
    if (!workflowId) throw new Error('No workflow available');

    const created = await service.createSession(SCRATCHPAD_PROJECT_ID, workflowId);
    const session = created.sessions[0];
    if (!session) throw new Error('Failed to create quick prompt session');

    quickPromptSessionId = session.id;

    // Apply model override if provided
    if (input.model) {
      await service.updateSessionModelConfig(session.id, input.model, input.reasoningEffort);
    }

    // Send the message (fire-and-forget — results arrive via session events)
    void service.sendSessionMessage(session.id, input.content);

    return { sessionId: session.id };
  });

  ipcMain.handle(ipcChannels.quickPromptCancelTurn, async () => {
    if (quickPromptSessionId) {
      await service.cancelSessionTurn(quickPromptSessionId);
    }
  });

  ipcMain.handle(ipcChannels.quickPromptDiscard, async () => {
    if (quickPromptSessionId) {
      await service.deleteSession(quickPromptSessionId);
      quickPromptSessionId = undefined;
    }
    if (quickPromptWindow) hideQuickPromptWindow(quickPromptWindow);
  });

  ipcMain.handle(ipcChannels.quickPromptClose, async () => {
    quickPromptSessionId = undefined;
    if (quickPromptWindow) hideQuickPromptWindow(quickPromptWindow);
  });

  ipcMain.handle(ipcChannels.quickPromptContinueInAryx, async () => {
    if (quickPromptSessionId) {
      await service.selectSession(quickPromptSessionId);
      quickPromptSessionId = undefined;
    }
    if (quickPromptWindow) hideQuickPromptWindow(quickPromptWindow);
    // Show and focus the main window
    if (!window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  ipcMain.handle(ipcChannels.quickPromptGetCapabilities, async () => {
    const capabilities = await service.describeSidecarCapabilities();
    const settings = service.getQuickPromptSettings();
    const models = buildAvailableModelCatalog(capabilities.models);
    return {
      models,
      defaultModel: settings.defaultModel,
      defaultReasoningEffort: settings.defaultReasoningEffort,
    };
  });

  ipcMain.handle(
    ipcChannels.quickPromptSetSettings,
    (_event, settings: Partial<QuickPromptSettings>) => service.setQuickPromptSettings(settings),
  );

  ipcMain.handle(
    ipcChannels.quickPromptGetSettings,
    () => service.getQuickPromptSettings(),
  );

  // Route session events to the quick prompt window
  if (quickPromptWindow) {
    service.on('session-event', (event) => {
      if (event.sessionId === quickPromptSessionId && !quickPromptWindow.isDestroyed()) {
        quickPromptWindow.webContents.send(ipcChannels.quickPromptSessionEvent, event);
      }
    });
  }
}
