import electron from 'electron';

import type { QuickPromptElectronApi } from '@shared/contracts/ipc';

const { contextBridge, ipcRenderer } = electron;

// Channel constants are inlined here (not imported from @shared/contracts/channels)
// to avoid Rollup code-splitting a shared chunk that Electron's sandboxed preload
// environment cannot resolve at runtime.
const ch = {
  send: 'quick-prompt:send',
  discard: 'quick-prompt:discard',
  close: 'quick-prompt:close',
  continueInAryx: 'quick-prompt:continue-in-aryx',
  cancelTurn: 'quick-prompt:cancel-turn',
  getCapabilities: 'quick-prompt:get-capabilities',
  setSettings: 'quick-prompt:set-settings',
  sessionEvent: 'quick-prompt:session-event',
  show: 'quick-prompt:show',
  hide: 'quick-prompt:hide',
} as const;

const api: QuickPromptElectronApi = {
  send: (input) => ipcRenderer.invoke(ch.send, input),
  discard: () => ipcRenderer.invoke(ch.discard),
  close: () => ipcRenderer.invoke(ch.close),
  continueInAryx: () => ipcRenderer.invoke(ch.continueInAryx),
  cancelTurn: () => ipcRenderer.invoke(ch.cancelTurn),
  getCapabilities: () => ipcRenderer.invoke(ch.getCapabilities),
  setSettings: (settings) => ipcRenderer.invoke(ch.setSettings, settings),
  onSessionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionEvent: Parameters<typeof listener>[0]) =>
      listener(sessionEvent);

    ipcRenderer.on(ch.sessionEvent, handler);
    return () => ipcRenderer.off(ch.sessionEvent, handler);
  },
  onShow: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(ch.show, handler);
    return () => ipcRenderer.off(ch.show, handler);
  },
  onHide: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(ch.hide, handler);
    return () => ipcRenderer.off(ch.hide, handler);
  },
};

contextBridge.exposeInMainWorld('quickPromptApi', api);
