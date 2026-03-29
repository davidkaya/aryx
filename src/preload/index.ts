import electron from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type { ElectronApi } from '@shared/contracts/ipc';

const { contextBridge, ipcRenderer } = electron;

const api: ElectronApi = {
  describeSidecarCapabilities: () => ipcRenderer.invoke(ipcChannels.describeSidecarCapabilities),
  refreshSidecarCapabilities: () => ipcRenderer.invoke(ipcChannels.refreshSidecarCapabilities),
  loadWorkspace: () => ipcRenderer.invoke(ipcChannels.loadWorkspace),
  addProject: () => ipcRenderer.invoke(ipcChannels.addProject),
  removeProject: (projectId) => ipcRenderer.invoke(ipcChannels.removeProject, projectId),
  resolveWorkspaceDiscoveredTooling: (input) =>
    ipcRenderer.invoke(ipcChannels.resolveWorkspaceDiscoveredTooling, input),
  refreshProjectGitContext: (projectId) => ipcRenderer.invoke(ipcChannels.refreshProjectGitContext, projectId),
  rescanProjectConfigs: (input) => ipcRenderer.invoke(ipcChannels.rescanProjectConfigs, input),
  rescanProjectCustomization: (input) =>
    ipcRenderer.invoke(ipcChannels.rescanProjectCustomization, input),
  resolveProjectDiscoveredTooling: (input) =>
    ipcRenderer.invoke(ipcChannels.resolveProjectDiscoveredTooling, input),
  setProjectAgentProfileEnabled: (input) =>
    ipcRenderer.invoke(ipcChannels.setProjectAgentProfileEnabled, input),
  savePattern: (input) => ipcRenderer.invoke(ipcChannels.savePattern, input),
  deletePattern: (patternId) => ipcRenderer.invoke(ipcChannels.deletePattern, patternId),
  setPatternFavorite: (input) => ipcRenderer.invoke(ipcChannels.setPatternFavorite, input),
  setTheme: (theme) => ipcRenderer.invoke(ipcChannels.setTheme, theme),
  setTerminalHeight: (input) => ipcRenderer.invoke(ipcChannels.setTerminalHeight, input),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke(ipcChannels.setNotificationsEnabled, enabled),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke(ipcChannels.setMinimizeToTray, enabled),
  saveMcpServer: (input) => ipcRenderer.invoke(ipcChannels.saveMcpServer, input),
  deleteMcpServer: (serverId) => ipcRenderer.invoke(ipcChannels.deleteMcpServer, serverId),
  saveLspProfile: (input) => ipcRenderer.invoke(ipcChannels.saveLspProfile, input),
  deleteLspProfile: (profileId) => ipcRenderer.invoke(ipcChannels.deleteLspProfile, profileId),
  describeTerminal: () => ipcRenderer.invoke(ipcChannels.describeTerminal),
  createTerminal: () => ipcRenderer.invoke(ipcChannels.createTerminal),
  restartTerminal: () => ipcRenderer.invoke(ipcChannels.restartTerminal),
  killTerminal: () => ipcRenderer.invoke(ipcChannels.killTerminal),
  writeTerminal: (data) => {
    ipcRenderer.send(ipcChannels.writeTerminal, data);
  },
  resizeTerminal: (input) => {
    ipcRenderer.send(ipcChannels.resizeTerminal, input);
  },
  updateSessionTooling: (input) => ipcRenderer.invoke(ipcChannels.updateSessionTooling, input),
  updateSessionApprovalSettings: (input) =>
    ipcRenderer.invoke(ipcChannels.updateSessionApprovalSettings, input),
  createSession: (input) => ipcRenderer.invoke(ipcChannels.createSession, input),
  duplicateSession: (input) => ipcRenderer.invoke(ipcChannels.duplicateSession, input),
  renameSession: (input) => ipcRenderer.invoke(ipcChannels.renameSession, input),
  setSessionPinned: (input) => ipcRenderer.invoke(ipcChannels.setSessionPinned, input),
  setSessionArchived: (input) => ipcRenderer.invoke(ipcChannels.setSessionArchived, input),
  deleteSession: (input) => ipcRenderer.invoke(ipcChannels.deleteSession, input),
  sendSessionMessage: (input) => ipcRenderer.invoke(ipcChannels.sendSessionMessage, input),
  cancelSessionTurn: (input) => ipcRenderer.invoke(ipcChannels.cancelSessionTurn, input),
  resolveSessionApproval: (input) => ipcRenderer.invoke(ipcChannels.resolveSessionApproval, input),
  resolveSessionUserInput: (input) => ipcRenderer.invoke(ipcChannels.resolveSessionUserInput, input),
  setSessionInteractionMode: (input) => ipcRenderer.invoke(ipcChannels.setSessionInteractionMode, input),
  dismissSessionPlanReview: (input) => ipcRenderer.invoke(ipcChannels.dismissSessionPlanReview, input),
  dismissSessionMcpAuth: (input) => ipcRenderer.invoke(ipcChannels.dismissSessionMcpAuth, input),
  startSessionMcpAuth: (input) => ipcRenderer.invoke(ipcChannels.startSessionMcpAuth, input),
  updateSessionModelConfig: (input) =>
    ipcRenderer.invoke(ipcChannels.updateSessionModelConfig, input),
  querySessions: (input) => ipcRenderer.invoke(ipcChannels.querySessions, input),
  selectProject: (projectId) => ipcRenderer.invoke(ipcChannels.selectProject, projectId),
  selectPattern: (patternId) => ipcRenderer.invoke(ipcChannels.selectPattern, patternId),
  selectSession: (sessionId) => ipcRenderer.invoke(ipcChannels.selectSession, sessionId),
  openAppDataFolder: () => ipcRenderer.invoke(ipcChannels.openAppDataFolder),
  resetLocalWorkspace: () => ipcRenderer.invoke(ipcChannels.resetLocalWorkspace),
  getQuota: () => ipcRenderer.invoke(ipcChannels.getQuota),
  onTerminalData: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof listener>[0]) =>
      listener(data);

    ipcRenderer.on(ipcChannels.terminalData, handler);
    return () => ipcRenderer.off(ipcChannels.terminalData, handler);
  },
  onTerminalExit: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, info: Parameters<typeof listener>[0]) =>
      listener(info);

    ipcRenderer.on(ipcChannels.terminalExit, handler);
    return () => ipcRenderer.off(ipcChannels.terminalExit, handler);
  },
  onWorkspaceUpdated:(listener) => {
    const handler = (_event: Electron.IpcRendererEvent, workspace: Awaited<ReturnType<ElectronApi['loadWorkspace']>>) =>
      listener(workspace);

    ipcRenderer.on(ipcChannels.workspaceUpdated, handler);
    return () => ipcRenderer.off(ipcChannels.workspaceUpdated, handler);
  },
  onSessionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionEvent: Parameters<typeof listener>[0]) =>
      listener(sessionEvent);

    ipcRenderer.on(ipcChannels.sessionEvent, handler);
    return () => ipcRenderer.off(ipcChannels.sessionEvent, handler);
  },
  onTrayCreateScratchpad: (listener) => {
    const handler = () => listener();

    ipcRenderer.on(ipcChannels.trayCreateScratchpad, handler);
    return () => ipcRenderer.off(ipcChannels.trayCreateScratchpad, handler);
  },
};

contextBridge.exposeInMainWorld('aryxApi', api);
