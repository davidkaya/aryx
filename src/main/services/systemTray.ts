import electron from 'electron';
import { join } from 'node:path';

import type { WorkspaceState } from '@shared/domain/workspace';

const { app, Menu, Tray, nativeImage } = electron;
type TrayType = InstanceType<typeof Tray>;
type NativeImageType = ReturnType<typeof nativeImage.createFromPath>;

export interface SystemTrayOptions {
  onShowWindow: () => void;
  onCreateScratchpad: () => void;
  onQuit: () => void;
}

function resolveTrayIcon(): NativeImageType {
  const basePath = app.getAppPath();

  if (process.platform === 'win32') {
    return nativeImage.createFromPath(join(basePath, 'assets', 'icons', 'windows', 'icon.ico'));
  }

  // Use a smaller icon for tray on Linux/macOS — 32x32 for crispness
  const pngPath =
    process.platform === 'linux'
      ? join(basePath, 'assets', 'icons', 'linux', 'icons', '32x32.png')
      : join(basePath, 'assets', 'icons', 'icon.png');

  const image = nativeImage.createFromPath(pngPath);

  // Resize to 16x16 for system tray standard size
  return image.resize({ width: 16, height: 16 });
}

function buildContextMenu(options: SystemTrayOptions, runningCount: number): Electron.Menu {
  const statusLabel =
    runningCount > 0 ? `${runningCount} session${runningCount > 1 ? 's' : ''} running` : 'No active sessions';

  return Menu.buildFromTemplate([
    { label: 'Open Aryx', click: options.onShowWindow, type: 'normal' },
    { type: 'separator' },
    { label: 'Quick Scratchpad', click: options.onCreateScratchpad, type: 'normal' },
    { type: 'separator' },
    { label: statusLabel, enabled: false, type: 'normal' },
    { type: 'separator' },
    { label: 'Quit', click: options.onQuit, type: 'normal' },
  ]);
}

export class SystemTray {
  private tray: TrayType | null = null;
  private options: SystemTrayOptions;
  private runningCount = 0;

  constructor(options: SystemTrayOptions) {
    this.options = options;
  }

  create(): void {
    if (this.tray) return;

    const icon = resolveTrayIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip('Aryx');
    this.tray.setContextMenu(buildContextMenu(this.options, this.runningCount));

    this.tray.on('click', () => {
      this.options.onShowWindow();
    });
  }

  updateRunningCount(workspace: WorkspaceState): void {
    const count = workspace.sessions.filter((s) => !s.isArchived && s.status === 'running').length;
    if (count === this.runningCount) return;

    this.runningCount = count;
    this.tray?.setContextMenu(buildContextMenu(this.options, count));

    const tooltip = count > 0 ? `Aryx — ${count} running` : 'Aryx';
    this.tray?.setToolTip(tooltip);
  }

  isMinimizeToTrayEnabled(workspace: WorkspaceState): boolean {
    return workspace.settings.minimizeToTray === true;
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

/**
 * Intercept window close to hide to tray instead of quitting, when the setting is enabled.
 * Returns true if the close was intercepted (window hidden), false if it should proceed normally.
 */
export function setupCloseToTray(
  window: Electron.BrowserWindow,
  getMinimizeToTray: () => boolean,
): void {
  let forceQuit = false;

  // On macOS, Cmd+Q triggers before-quit before the close event
  app.on('before-quit', () => {
    forceQuit = true;
  });

  window.on('close', (event) => {
    if (forceQuit) return;

    if (getMinimizeToTray()) {
      event.preventDefault();
      window.hide();

      // On macOS, also hide from the dock when minimized to tray
      if (process.platform === 'darwin') {
        app.dock?.hide();
      }
    }
  });
}

/**
 * Show and focus the main window, restoring from tray if hidden.
 */
export function showAndFocusWindow(mainWindow: Electron.BrowserWindow): void {
  if (mainWindow.isDestroyed()) return;

  // On macOS, show the dock icon again
  if (process.platform === 'darwin') {
    app.dock?.show();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}
