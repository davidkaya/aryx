import type { PatternDefinition } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionEventRecord } from '@shared/domain/event';
import type { WorkspaceState } from '@shared/domain/workspace';

export interface CreateSessionInput {
  projectId: string;
  patternId: string;
}

export interface SavePatternInput {
  pattern: PatternDefinition;
}

export interface SendSessionMessageInput {
  sessionId: string;
  content: string;
}

export interface ElectronApi {
  loadWorkspace(): Promise<WorkspaceState>;
  addProject(): Promise<WorkspaceState>;
  removeProject(projectId: string): Promise<WorkspaceState>;
  savePattern(input: SavePatternInput): Promise<WorkspaceState>;
  deletePattern(patternId: string): Promise<WorkspaceState>;
  createSession(input: CreateSessionInput): Promise<WorkspaceState>;
  sendSessionMessage(input: SendSessionMessageInput): Promise<void>;
  selectProject(projectId?: string): Promise<WorkspaceState>;
  selectPattern(patternId?: string): Promise<WorkspaceState>;
  selectSession(sessionId?: string): Promise<WorkspaceState>;
  onWorkspaceUpdated(listener: (workspace: WorkspaceState) => void): () => void;
  onSessionEvent(listener: (event: SessionEventRecord) => void): () => void;
}

export interface RendererSelectionState {
  selectedProject?: ProjectRecord;
  selectedPattern?: PatternDefinition;
}
