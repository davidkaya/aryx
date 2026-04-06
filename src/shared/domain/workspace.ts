import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSettings, type WorkspaceSettings } from '@shared/domain/tooling';
import {
  createBuiltinWorkflowTemplates,
  type WorkflowTemplateDefinition,
} from '@shared/domain/workflowTemplate';
import { createBuiltinWorkflows, type WorkflowDefinition } from '@shared/domain/workflow';
import { nowIso } from '@shared/utils/ids';

export interface WorkspaceState {
  projects: ProjectRecord[];
  workflows: WorkflowDefinition[];
  workflowTemplates: WorkflowTemplateDefinition[];
  sessions: SessionRecord[];
  settings: WorkspaceSettings;
  /** Runtime-only MCP probe progress for live UI updates. */
  mcpProbingServerIds?: string[];
  selectedProjectId?: string;
  selectedWorkflowId?: string;
  selectedSessionId?: string;
  lastUpdatedAt: string;
}

export function createWorkspaceSeed(): WorkspaceState {
  const timestamp = nowIso();
  return {
    projects: [],
    workflows: createBuiltinWorkflows(timestamp),
    workflowTemplates: createBuiltinWorkflowTemplates(timestamp),
    sessions: [],
    settings: createWorkspaceSettings(),
    lastUpdatedAt: timestamp,
  };
}
