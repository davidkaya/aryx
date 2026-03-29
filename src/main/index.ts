import electron from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';

import { registerIpcHandlers } from '@main/ipc/registerIpcHandlers';
import { AryxAppService } from '@main/AryxAppService';
import { AutoUpdateService } from '@main/services/autoUpdater';
import { createMainWindow } from '@main/windows/createMainWindow';
import { applyTitleBarTheme } from '@main/windows/titleBarTheme';
import { SystemTray, setupCloseToTray, showAndFocusWindow } from '@main/services/systemTray';

const { app, BrowserWindow } = electron;

let mainWindow: BrowserWindowType | undefined;
let appService: AryxAppService | undefined;
let systemTray: SystemTray | undefined;
let autoUpdateService: AutoUpdateService | undefined;

async function bootstrap(): Promise<void> {
  appService = new AryxAppService();
  autoUpdateService?.dispose();
  autoUpdateService = new AutoUpdateService({ isPackaged: app.isPackaged });

  mainWindow = createMainWindow();
  registerIpcHandlers(mainWindow, appService, autoUpdateService);

  // Apply persisted theme to the title bar overlay
  const workspace = await appService.loadWorkspace();
  applyTitleBarTheme(mainWindow, workspace.settings.theme);

  // Set up system tray
  systemTray = new SystemTray({
    onShowWindow: showAndFocusWindow,
    onCreateScratchpad: () => {
      showAndFocusWindow();
      mainWindow?.webContents.send('tray:create-scratchpad');
    },
    onQuit: () => app.quit(),
  });
  systemTray.create();
  systemTray.updateRunningCount(workspace);

  // Intercept close to hide to tray when the setting is enabled
  setupCloseToTray(mainWindow, () => {
    const currentWorkspace = appService?.getCachedWorkspace();
    return currentWorkspace?.settings.minimizeToTray === true;
  });

  // Keep tray status in sync when workspace changes
  appService.on('workspace-updated', (updatedWorkspace) => {
    systemTray?.updateRunningCount(updatedWorkspace);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  autoUpdateService.start();
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // When minimize-to-tray is enabled, don't quit on window close
  if (process.platform === 'darwin') return;

  const windows = BrowserWindow.getAllWindows();
  const allHidden = windows.length > 0 && windows.every((w) => !w.isVisible());
  if (allHidden) return;

  app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await bootstrap();
  } else {
    showAndFocusWindow();
  }
});

app.on('before-quit', async () => {
  autoUpdateService?.dispose();
  autoUpdateService = undefined;
  systemTray?.dispose();
  await appService?.dispose();
});
