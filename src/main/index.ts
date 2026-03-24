import { app, BrowserWindow } from 'electron';

import { registerIpcHandlers } from '@main/ipc/registerIpcHandlers';
import { EryxAppService } from '@main/EryxAppService';
import { createMainWindow } from '@main/windows/createMainWindow';
import { applyTitleBarTheme } from '@main/windows/titleBarTheme';

let mainWindow: BrowserWindow | undefined;
let appService: EryxAppService | undefined;

async function bootstrap(): Promise<void> {
  appService = new EryxAppService();

  mainWindow = createMainWindow();
  registerIpcHandlers(mainWindow, appService);

  // Apply persisted theme to the title bar overlay
  const workspace = await appService.loadWorkspace();
  applyTitleBarTheme(mainWindow, workspace.settings.theme);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await bootstrap();
  }
});

app.on('before-quit', async () => {
  await appService?.dispose();
});
