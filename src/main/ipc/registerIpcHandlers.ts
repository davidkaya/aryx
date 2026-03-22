import { BrowserWindow, ipcMain } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type {
  CreateSessionInput,
  SavePatternInput,
  SendSessionMessageInput,
  UpdateScratchpadSessionConfigInput,
} from '@shared/contracts/ipc';

import { KopayaAppService } from '@main/KopayaAppService';

export function registerIpcHandlers(window: BrowserWindow, service: KopayaAppService): void {
  ipcMain.handle(ipcChannels.describeSidecarCapabilities, () => service.describeSidecarCapabilities());
  ipcMain.handle(ipcChannels.loadWorkspace, () => service.loadWorkspace());
  ipcMain.handle(ipcChannels.addProject, () => service.addProject());
  ipcMain.handle(ipcChannels.removeProject, (_event, projectId: string) => service.removeProject(projectId));
  ipcMain.handle(ipcChannels.savePattern, (_event, input: SavePatternInput) => service.savePattern(input.pattern));
  ipcMain.handle(ipcChannels.deletePattern, (_event, patternId: string) => service.deletePattern(patternId));
  ipcMain.handle(ipcChannels.createSession, (_event, input: CreateSessionInput) =>
    service.createSession(input.projectId, input.patternId),
  );
  ipcMain.handle(ipcChannels.sendSessionMessage, (_event, input: SendSessionMessageInput) =>
    service.sendSessionMessage(input.sessionId, input.content),
  );
  ipcMain.handle(
    ipcChannels.updateScratchpadSessionConfig,
    (_event, input: UpdateScratchpadSessionConfigInput) =>
      service.updateScratchpadSessionConfig(input.sessionId, input.model, input.reasoningEffort),
  );
  ipcMain.handle(ipcChannels.selectProject, (_event, projectId?: string) => service.selectProject(projectId));
  ipcMain.handle(ipcChannels.selectPattern, (_event, patternId?: string) => service.selectPattern(patternId));
  ipcMain.handle(ipcChannels.selectSession, (_event, sessionId?: string) => service.selectSession(sessionId));

  service.on('workspace-updated', (workspace) => {
    window.webContents.send(ipcChannels.workspaceUpdated, workspace);
  });

  service.on('session-event', (event) => {
    window.webContents.send(ipcChannels.sessionEvent, event);
  });
}
