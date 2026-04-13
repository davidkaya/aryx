import electron from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { join } from 'node:path';

import { resolveWindowIconPath } from '@main/windows/appIcon';

const { app, BrowserWindow, screen } = electron;

export function createQuickPromptWindow(): BrowserWindowType {
  const window = new BrowserWindow({
    width: 680,
    height: 520,
    minHeight: 72,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: true,
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

  // Hide on blur — but only if the window itself loses focus (not from
  // devtools or transient focus changes during show/hide).
  window.on('blur', () => {
    // Longer delay: avoid hiding during transient focus shifts when
    // interacting with model selector dropdown or other UI elements.
    setTimeout(() => {
      if (window.isVisible() && !window.isFocused()) {
        window.webContents.send('quick-prompt:hide');
        window.hide();
      }
    }, 200);
  });

  return window;
}

export async function toggleQuickPromptWindow(window: BrowserWindowType): Promise<void> {
  if (window.isVisible()) {
    window.webContents.send('quick-prompt:hide');
    window.hide();
    return;
  }

  // Wait for the renderer to finish loading before showing — on the very
  // first activation the page may still be loading from disk/dev-server.
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve());
    });
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
