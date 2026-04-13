import electron from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type { QuickPromptElectronApi } from '@shared/contracts/ipc';

const { contextBridge, ipcRenderer } = electron;

const api: QuickPromptElectronApi = {
  send: (input) => ipcRenderer.invoke(ipcChannels.quickPromptSend, input),
  discard: () => ipcRenderer.invoke(ipcChannels.quickPromptDiscard),
  close: () => ipcRenderer.invoke(ipcChannels.quickPromptClose),
  continueInAryx: () => ipcRenderer.invoke(ipcChannels.quickPromptContinueInAryx),
  cancelTurn: () => ipcRenderer.invoke(ipcChannels.quickPromptCancelTurn),
  getCapabilities: () => ipcRenderer.invoke(ipcChannels.quickPromptGetCapabilities),
  setSettings: (settings) => ipcRenderer.invoke(ipcChannels.quickPromptSetSettings, settings),
  onSessionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionEvent: Parameters<typeof listener>[0]) =>
      listener(sessionEvent);

    ipcRenderer.on(ipcChannels.quickPromptSessionEvent, handler);
    return () => ipcRenderer.off(ipcChannels.quickPromptSessionEvent, handler);
  },
  onShow: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(ipcChannels.quickPromptShow, handler);
    return () => ipcRenderer.off(ipcChannels.quickPromptShow, handler);
  },
  onHide: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(ipcChannels.quickPromptHide, handler);
    return () => ipcRenderer.off(ipcChannels.quickPromptHide, handler);
  },
};

contextBridge.exposeInMainWorld('quickPromptApi', api);
