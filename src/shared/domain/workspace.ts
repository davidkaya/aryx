import type { PatternDefinition } from '@shared/domain/pattern';
import { createBuiltinPatterns } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { nowIso } from '@shared/utils/ids';

export interface WorkspaceState {
  projects: ProjectRecord[];
  patterns: PatternDefinition[];
  sessions: SessionRecord[];
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
    lastUpdatedAt: timestamp,
  };
}
