import electron from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { join } from 'node:path';

import { resolveWindowIconPath } from '@main/windows/appIcon';

const { app, BrowserWindow, screen } = electron;

export function createQuickPromptWindow(): BrowserWindowType {
  const window = new BrowserWindow({
    width: 680,
    height: 72,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: 'Aryx Quick Prompt',
    icon: resolveWindowIconPath({
      appPath: app.getAppPath(),
      platform: process.platform,
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/quickprompt.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}/quickprompt.html`);
  } else {
    void window.loadFile(join(__dirname, '../../dist/renderer/quickprompt.html'));
  }

  window.on('blur', () => {
    if (window.isVisible()) {
      window.webContents.send('quick-prompt:hide');
      window.hide();
    }
  });

  return window;
}

export function toggleQuickPromptWindow(window: BrowserWindowType): void {
  if (window.isVisible()) {
    window.webContents.send('quick-prompt:hide');
    window.hide();
    return;
  }

  centerOnActiveDisplay(window);
  window.webContents.send('quick-prompt:show');
  window.show();
  window.focus();
}

export function showQuickPromptWindow(window: BrowserWindowType): void {
  centerOnActiveDisplay(window);
  window.webContents.send('quick-prompt:show');
  window.show();
  window.focus();
}

export function hideQuickPromptWindow(window: BrowserWindowType): void {
  if (!window.isVisible()) return;
  window.webContents.send('quick-prompt:hide');
  window.hide();
}

function centerOnActiveDisplay(window: BrowserWindowType): void {
  const cursorPoint = screen.getCursorScreenPoint();
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = activeDisplay.workArea;

  const [windowWidth] = window.getSize();
  const windowX = Math.round(x + (width - windowWidth) / 2);
  // Position in the upper-third of the screen for command-bar feel
  const windowY = Math.round(y + height * 0.25);

  window.setPosition(windowX, windowY);
}
