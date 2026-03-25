import type { ProjectRecord } from '@shared/domain/project';
import { resolveProjectToolingSettings, type WorkspaceToolingSettings } from '@shared/domain/tooling';
import type { WorkspaceState } from '@shared/domain/workspace';

export function resolveChatToolingSettings(
  workspace: WorkspaceState | undefined,
  projectForSession: ProjectRecord | undefined,
): WorkspaceToolingSettings | undefined {
  if (!workspace) {
    return undefined;
  }

  return resolveProjectToolingSettings(workspace.settings, projectForSession?.discoveredTooling);
}
