import { contextBridge, ipcRenderer } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type { ElectronApi } from '@shared/contracts/ipc';

const api: ElectronApi = {
  describeSidecarCapabilities: () => ipcRenderer.invoke(ipcChannels.describeSidecarCapabilities),
  refreshSidecarCapabilities: () => ipcRenderer.invoke(ipcChannels.refreshSidecarCapabilities),
  loadWorkspace: () => ipcRenderer.invoke(ipcChannels.loadWorkspace),
  addProject: () => ipcRenderer.invoke(ipcChannels.addProject),
  removeProject: (projectId) => ipcRenderer.invoke(ipcChannels.removeProject, projectId),
  savePattern: (input) => ipcRenderer.invoke(ipcChannels.savePattern, input),
  deletePattern: (patternId) => ipcRenderer.invoke(ipcChannels.deletePattern, patternId),
  createSession: (input) => ipcRenderer.invoke(ipcChannels.createSession, input),
  sendSessionMessage: (input) => ipcRenderer.invoke(ipcChannels.sendSessionMessage, input),
  updateScratchpadSessionConfig: (input) =>
    ipcRenderer.invoke(ipcChannels.updateScratchpadSessionConfig, input),
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

contextBridge.exposeInMainWorld('kopayaApi', api);
