import type { PatternDefinition } from '@shared/domain/pattern';
import { createBuiltinPatterns } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSettings, type WorkspaceSettings } from '@shared/domain/tooling';
import {
  createBuiltinWorkflowTemplates,
  type WorkflowTemplateDefinition,
} from '@shared/domain/workflowTemplate';
import type { WorkflowDefinition } from '@shared/domain/workflow';
import { nowIso } from '@shared/utils/ids';

export interface WorkspaceState {
  projects: ProjectRecord[];
  patterns: PatternDefinition[];
  workflows: WorkflowDefinition[];
  workflowTemplates: WorkflowTemplateDefinition[];
  sessions: SessionRecord[];
  settings: WorkspaceSettings;
  /** IDs of built-in patterns the user has deleted. Prevents re-adding on load. */
  deletedBuiltinPatternIds?: string[];
  /** Runtime-only MCP probe progress for live UI updates. */
  mcpProbingServerIds?: string[];
  selectedProjectId?: string;
  selectedPatternId?: string;
  selectedWorkflowId?: string;
  selectedSessionId?: string;
  lastUpdatedAt: string;
}

export function createWorkspaceSeed(): WorkspaceState {
  const timestamp = nowIso();
  return {
    projects: [],
    patterns: createBuiltinPatterns(timestamp),
    workflows: [],
    workflowTemplates: createBuiltinWorkflowTemplates(timestamp),
    sessions: [],
    settings: createWorkspaceSettings(),
    lastUpdatedAt: timestamp,
  };
}
