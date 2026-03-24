import { contextBridge, ipcRenderer } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type { ElectronApi } from '@shared/contracts/ipc';

const api: ElectronApi = {
  describeSidecarCapabilities: () => ipcRenderer.invoke(ipcChannels.describeSidecarCapabilities),
  refreshSidecarCapabilities: () => ipcRenderer.invoke(ipcChannels.refreshSidecarCapabilities),
  loadWorkspace: () => ipcRenderer.invoke(ipcChannels.loadWorkspace),
  addProject: () => ipcRenderer.invoke(ipcChannels.addProject),
  removeProject: (projectId) => ipcRenderer.invoke(ipcChannels.removeProject, projectId),
  refreshProjectGitContext: (projectId) => ipcRenderer.invoke(ipcChannels.refreshProjectGitContext, projectId),
  savePattern: (input) => ipcRenderer.invoke(ipcChannels.savePattern, input),
  deletePattern: (patternId) => ipcRenderer.invoke(ipcChannels.deletePattern, patternId),
  setPatternFavorite: (input) => ipcRenderer.invoke(ipcChannels.setPatternFavorite, input),
  setTheme: (theme) => ipcRenderer.invoke(ipcChannels.setTheme, theme),
  saveMcpServer: (input) => ipcRenderer.invoke(ipcChannels.saveMcpServer, input),
  deleteMcpServer: (serverId) => ipcRenderer.invoke(ipcChannels.deleteMcpServer, serverId),
  saveLspProfile: (input) => ipcRenderer.invoke(ipcChannels.saveLspProfile, input),
  deleteLspProfile: (profileId) => ipcRenderer.invoke(ipcChannels.deleteLspProfile, profileId),
  updateSessionTooling: (input) => ipcRenderer.invoke(ipcChannels.updateSessionTooling, input),
  updateSessionApprovalSettings: (input) =>
    ipcRenderer.invoke(ipcChannels.updateSessionApprovalSettings, input),
  createSession: (input) => ipcRenderer.invoke(ipcChannels.createSession, input),
  duplicateSession: (input) => ipcRenderer.invoke(ipcChannels.duplicateSession, input),
  renameSession: (input) => ipcRenderer.invoke(ipcChannels.renameSession, input),
  setSessionPinned: (input) => ipcRenderer.invoke(ipcChannels.setSessionPinned, input),
  setSessionArchived: (input) => ipcRenderer.invoke(ipcChannels.setSessionArchived, input),
  sendSessionMessage: (input) => ipcRenderer.invoke(ipcChannels.sendSessionMessage, input),
  resolveSessionApproval: (input) => ipcRenderer.invoke(ipcChannels.resolveSessionApproval, input),
  updateScratchpadSessionConfig: (input) =>
    ipcRenderer.invoke(ipcChannels.updateScratchpadSessionConfig, input),
  querySessions: (input) => ipcRenderer.invoke(ipcChannels.querySessions, input),
  selectProject: (projectId) => ipcRenderer.invoke(ipcChannels.selectProject, projectId),
  selectPattern: (patternId) => ipcRenderer.invoke(ipcChannels.selectPattern, patternId),
  selectSession: (sessionId) => ipcRenderer.invoke(ipcChannels.selectSession, sessionId),
  onWorkspaceUpdated: (listener) => {
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
};

contextBridge.exposeInMainWorld('eryxApi', api);
