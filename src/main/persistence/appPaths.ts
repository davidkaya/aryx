import electron from 'electron';
import { join } from 'node:path';

const { app } = electron;

export function getWorkspaceFilePath(): string {
  return join(app.getPath('userData'), 'workspace.json');
}

export function getScratchpadDirectoryPath(): string {
  return join(app.getPath('userData'), 'scratchpad');
}
