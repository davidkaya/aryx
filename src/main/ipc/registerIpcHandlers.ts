import { BrowserWindow, ipcMain } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type {
  CreateSessionInput,
  DuplicateSessionInput,
  RenameSessionInput,
  SaveLspProfileInput,
  SaveMcpServerInput,
  SavePatternInput,
  SendSessionMessageInput,
  SetPatternFavoriteInput,
  SetSessionArchivedInput,
  SetSessionPinnedInput,
  UpdateSessionToolingInput,
  UpdateScratchpadSessionConfigInput,
} from '@shared/contracts/ipc';
import type { QuerySessionsInput } from '@shared/domain/sessionLibrary';
import type { AppearanceTheme } from '@shared/domain/tooling';

import { EryxAppService } from '@main/EryxAppService';

export function registerIpcHandlers(window: BrowserWindow, service: EryxAppService): void {
  ipcMain.handle(ipcChannels.describeSidecarCapabilities, () => service.describeSidecarCapabilities());
  ipcMain.handle(ipcChannels.refreshSidecarCapabilities, () => service.refreshSidecarCapabilities());
  ipcMain.handle(ipcChannels.loadWorkspace, () => service.loadWorkspace());
  ipcMain.handle(ipcChannels.addProject, () => service.addProject());
  ipcMain.handle(ipcChannels.removeProject, (_event, projectId: string) => service.removeProject(projectId));
  ipcMain.handle(ipcChannels.refreshProjectGitContext, (_event, projectId?: string) =>
    service.refreshProjectGitContext(projectId),
  );
  ipcMain.handle(ipcChannels.savePattern, (_event, input: SavePatternInput) => service.savePattern(input.pattern));
  ipcMain.handle(ipcChannels.deletePattern, (_event, patternId: string) => service.deletePattern(patternId));
  ipcMain.handle(ipcChannels.setPatternFavorite, (_event, input: SetPatternFavoriteInput) =>
    service.setPatternFavorite(input.patternId, input.isFavorite),
  );
  ipcMain.handle(ipcChannels.setTheme, (_event, theme: AppearanceTheme) =>
    service.setTheme(theme),
  );
  ipcMain.handle(ipcChannels.saveMcpServer, (_event, input: SaveMcpServerInput) =>
    service.saveMcpServer(input.server),
  );
  ipcMain.handle(ipcChannels.deleteMcpServer, (_event, serverId: string) =>
    service.deleteMcpServer(serverId),
  );
  ipcMain.handle(ipcChannels.saveLspProfile, (_event, input: SaveLspProfileInput) =>
    service.saveLspProfile(input.profile),
  );
  ipcMain.handle(ipcChannels.deleteLspProfile, (_event, profileId: string) =>
    service.deleteLspProfile(profileId),
  );
  ipcMain.handle(ipcChannels.updateSessionTooling, (_event, input: UpdateSessionToolingInput) =>
    service.updateSessionTooling(
      input.sessionId,
      input.enabledMcpServerIds,
      input.enabledLspProfileIds,
    ),
  );
  ipcMain.handle(ipcChannels.createSession, (_event, input: CreateSessionInput) =>
    service.createSession(input.projectId, input.patternId),
  );
  ipcMain.handle(ipcChannels.duplicateSession, (_event, input: DuplicateSessionInput) =>
    service.duplicateSession(input.sessionId),
  );
  ipcMain.handle(ipcChannels.renameSession, (_event, input: RenameSessionInput) =>
    service.renameSession(input.sessionId, input.title),
  );
  ipcMain.handle(ipcChannels.setSessionPinned, (_event, input: SetSessionPinnedInput) =>
    service.setSessionPinned(input.sessionId, input.isPinned),
  );
  ipcMain.handle(ipcChannels.setSessionArchived, (_event, input: SetSessionArchivedInput) =>
    service.setSessionArchived(input.sessionId, input.isArchived),
  );
  ipcMain.handle(ipcChannels.sendSessionMessage, (_event, input: SendSessionMessageInput) =>
    service.sendSessionMessage(input.sessionId, input.content),
  );
  ipcMain.handle(
    ipcChannels.updateScratchpadSessionConfig,
    (_event, input: UpdateScratchpadSessionConfigInput) =>
      service.updateScratchpadSessionConfig(input.sessionId, input.model, input.reasoningEffort),
  );
  ipcMain.handle(ipcChannels.querySessions, (_event, input: QuerySessionsInput) => service.querySessions(input));
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
