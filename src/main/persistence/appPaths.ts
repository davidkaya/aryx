import { app } from 'electron';
import { join } from 'node:path';

export function getWorkspaceFilePath(): string {
  return join(app.getPath('userData'), 'workspace.json');
}
