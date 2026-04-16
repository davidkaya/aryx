import electron from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';

import { registerIpcHandlers, registerQuickPromptIpcHandlers } from '@main/ipc/registerIpcHandlers';
import { AryxAppService } from '@main/AryxAppService';
import { AutoUpdateService } from '@main/services/autoUpdater';
import { GlobalHotkeyService } from '@main/services/globalHotkey';
import { createMainWindow } from '@main/windows/createMainWindow';
import {
  createQuickPromptWindow,
  toggleQuickPromptWindow,
} from '@main/windows/createQuickPromptWindow';
import { applyTitleBarTheme } from '@main/windows/titleBarTheme';
import { SystemTray, setupCloseToTray, showAndFocusWindow } from '@main/services/systemTray';
import { createDefaultQuickPromptSettings } from '@shared/domain/tooling';

const { app, BrowserWindow } = electron;

// Enforce single instance — quit immediately if another instance already holds the lock.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindowType | undefined;
let quickPromptWindow: BrowserWindowType | undefined;
let appService: AryxAppService | undefined;
let systemTray: SystemTray | undefined;
let autoUpdateService: AutoUpdateService | undefined;
let globalHotkeyService: GlobalHotkeyService | undefined;

let quickPromptInitialized = false;

/** Lazily creates the quick prompt window on first use. */
function ensureQuickPromptWindow(): BrowserWindowType | undefined {
  if (quickPromptWindow && !quickPromptWindow.isDestroyed()) return quickPromptWindow;
  if (quickPromptInitialized) return undefined;
  if (!mainWindow || !appService) return undefined;

  try {
    quickPromptWindow = createQuickPromptWindow();
    registerQuickPromptIpcHandlers(mainWindow, appService, quickPromptWindow);
    quickPromptInitialized = true;
  } catch (err) {
    console.error('[aryx] Failed to create quick prompt window:', err);
    quickPromptInitialized = true;
  }

  return quickPromptWindow;
}

async function bootstrap(): Promise<void> {
  appService = new AryxAppService();
  autoUpdateService?.dispose();
  autoUpdateService = new AutoUpdateService({ isPackaged: app.isPackaged });

  mainWindow = createMainWindow();

  registerIpcHandlers(mainWindow, appService, autoUpdateService);

  // Start workspace loading in parallel — don't block window from showing.
  // The renderer fetches the workspace via its own IPC call after mount.
  const workspaceReady = appService.loadWorkspace();

  // Apply theme, set up tray, and register global hotkey once workspace is available
  workspaceReady
    .then((workspace) => {
      if (!mainWindow) return;
      applyTitleBarTheme(mainWindow, workspace.settings.theme);

      systemTray = new SystemTray({
        onShowWindow: () => showAndFocusWindow(mainWindow!),
        onCreateScratchpad: () => {
          showAndFocusWindow(mainWindow!);
          mainWindow?.webContents.send('tray:create-scratchpad');
        },
        onQuit: () => app.quit(),
      });
      systemTray.create();
      systemTray.updateRunningCount(workspace);

      appService!.on('workspace-updated', (updatedWorkspace) => {
        systemTray?.updateRunningCount(updatedWorkspace);
      });

      // Register global hotkey — the quick prompt window is created lazily on
      // first press so it cannot interfere with main window startup.
      globalHotkeyService = new GlobalHotkeyService();
      const hotkeySettings = workspace.settings.quickPrompt ?? createDefaultQuickPromptSettings();
      globalHotkeyService.register(hotkeySettings, () => {
        const win = ensureQuickPromptWindow();
        if (win) void toggleQuickPromptWindow(win, appService!.getCurrentTheme());
      });

      // Re-register hotkey when settings change
      appService!.on('workspace-updated', (updatedWorkspace) => {
        const updatedSettings = updatedWorkspace.settings.quickPrompt ?? createDefaultQuickPromptSettings();
        globalHotkeyService?.update(updatedSettings);
      });
    })
    .catch((error) => {
      console.error('[aryx bootstrap] workspace load failed', error);
    });

  // Intercept close to hide to tray when the setting is enabled
  setupCloseToTray(mainWindow, () => {
    const currentWorkspace = appService?.getCachedWorkspace();
    return currentWorkspace?.settings.minimizeToTray === true;
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  autoUpdateService.start();
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showAndFocusWindow(mainWindow);
  }
});

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // When minimize-to-tray is enabled, don't quit on window close
  if (process.platform === 'darwin') return;

  const windows = BrowserWindow.getAllWindows();
  // Ignore the quick prompt window (it's always hidden, never truly closed)
  const visibleWindows = windows.filter((w) => w !== quickPromptWindow);
  const allHidden = visibleWindows.length > 0 && visibleWindows.every((w) => !w.isVisible());
  if (allHidden) return;

  app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await bootstrap();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    showAndFocusWindow(mainWindow);
  }
});

app.on('before-quit', async () => {
  globalHotkeyService?.dispose();
  autoUpdateService?.dispose();
  autoUpdateService = undefined;
  systemTray?.dispose();
  await appService?.dispose();
});
