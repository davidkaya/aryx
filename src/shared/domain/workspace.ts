import type { PatternDefinition } from '@shared/domain/pattern';
import { createBuiltinPatterns } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSettings, type WorkspaceSettings } from '@shared/domain/tooling';
import { nowIso } from '@shared/utils/ids';

export interface WorkspaceState {
  projects: ProjectRecord[];
  patterns: PatternDefinition[];
  sessions: SessionRecord[];
  settings: WorkspaceSettings;
  /** Runtime-only MCP probe progress for live UI updates. */
  mcpProbingServerIds?: string[];
  selectedProjectId?: string;
  selectedPatternId?: string;
  selectedSessionId?: string;
  lastUpdatedAt: string;
}

export function createWorkspaceSeed(): WorkspaceState {
  const timestamp = nowIso();
  return {
    projects: [],
    patterns: createBuiltinPatterns(timestamp),
    sessions: [],
    settings: createWorkspaceSettings(),
    lastUpdatedAt: timestamp,
  };
}
