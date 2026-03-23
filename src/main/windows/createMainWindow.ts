import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';

import { resolveWindowIconPath } from '@main/windows/appIcon';

export function createMainWindow(): BrowserWindow {
  Menu.setApplicationMenu(null);

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: 'eryx',
    icon: resolveWindowIconPath({
      appPath: app.getAppPath(),
      platform: process.platform,
    }),
    backgroundColor: '#09090b',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#09090b',
      symbolColor: '#a1a1aa',
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../../dist/renderer/index.html'));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}
