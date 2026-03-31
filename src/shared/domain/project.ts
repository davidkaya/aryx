import { nowIso } from '@shared/utils/ids';
import type { ProjectDiscoveredTooling } from '@shared/domain/discoveredTooling';
import type { ProjectCustomizationState } from '@shared/domain/projectCustomization';

export type ProjectGitContextStatus = 'ready' | 'not-repository' | 'git-missing' | 'error';

export interface ProjectGitChangeSummary {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface ProjectGitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  committedAt: string;
}

export interface ProjectGitCommitLogEntry extends ProjectGitCommitSummary {
  authorName: string;
  refNames?: string;
}

export type ProjectGitWorkingTreeFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'untracked';

export interface ProjectGitWorkingTreeFile {
  path: string;
  previousPath?: string;
  stagedStatus?: ProjectGitWorkingTreeFileStatus;
  unstagedStatus?: ProjectGitWorkingTreeFileStatus;
  isConflicted?: boolean;
}

export interface ProjectGitFileReference {
  path: string;
  previousPath?: string;
}

export interface ProjectGitDiffPreview extends ProjectGitFileReference {
  diff?: string;
  newFileContents?: string;
  isBinary?: boolean;
}

export interface ProjectGitBaselineFile extends ProjectGitFileReference {
  combinedDiff?: string;
  untrackedContentBase64?: string;
  isBinary?: boolean;
}

export interface ProjectGitWorkingTreeSnapshot {
  scannedAt: string;
  repoRoot: string;
  branch?: string;
  changedFileCount: number;
  changes: ProjectGitChangeSummary;
  files: ProjectGitWorkingTreeFile[];
}

export type ProjectGitRunChangeOrigin = 'run-created' | 'pre-existing';
export type ProjectGitRunChangeKind = ProjectGitWorkingTreeFileStatus | 'cleaned';

export interface ProjectGitRunChangeCounts {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  copied: number;
  typeChanged: number;
  unmerged: number;
  untracked: number;
  cleaned: number;
}

export interface ProjectGitRunChangedFile extends ProjectGitFileReference {
  kind: ProjectGitRunChangeKind;
  origin: ProjectGitRunChangeOrigin;
  stagedStatus?: ProjectGitWorkingTreeFileStatus;
  unstagedStatus?: ProjectGitWorkingTreeFileStatus;
  isConflicted?: boolean;
  additions: number;
  deletions: number;
  canRevert: boolean;
  preview?: ProjectGitDiffPreview;
}

export interface ProjectGitRunChangeSummary {
  generatedAt: string;
  branchAtStart?: string;
  branchAtEnd?: string;
  branchChanged?: boolean;
  fileCount: number;
  additions: number;
  deletions: number;
  counts: ProjectGitRunChangeCounts;
  files: ProjectGitRunChangedFile[];
}

export interface ProjectGitBranchSummary {
  name: string;
  isCurrent: boolean;
  upstream?: string;
}

export interface ProjectGitDetails {
  scannedAt: string;
  context: ProjectGitContext;
  workingTree?: ProjectGitWorkingTreeSnapshot;
  branches: ProjectGitBranchSummary[];
  recentCommits: ProjectGitCommitLogEntry[];
}

export type ProjectGitConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'refactor'
  | 'docs'
  | 'test'
  | 'chore';

export interface ProjectGitCommitMessageSuggestion {
  type: ProjectGitConventionalCommitType;
  subject: string;
  message: string;
}

export interface ProjectGitContext {
  status: ProjectGitContextStatus;
  scannedAt: string;
  repoRoot?: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  isDirty?: boolean;
  changedFileCount?: number;
  changes?: ProjectGitChangeSummary;
  head?: ProjectGitCommitSummary;
  errorMessage?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  git?: ProjectGitContext;
  discoveredTooling?: ProjectDiscoveredTooling;
  customization?: ProjectCustomizationState;
}

export const SCRATCHPAD_PROJECT_ID = 'project-scratchpad';
export const SCRATCHPAD_PROJECT_NAME = 'Scratchpad';

export function createScratchpadProject(path: string, addedAt = nowIso()): ProjectRecord {
  return {
    id: SCRATCHPAD_PROJECT_ID,
    name: SCRATCHPAD_PROJECT_NAME,
    path,
    addedAt,
  };
}

export function isScratchpadProject(projectIdOrProject?: string | Pick<ProjectRecord, 'id'>): boolean {
  if (!projectIdOrProject) {
    return false;
  }

  return (
    (typeof projectIdOrProject === 'string' ? projectIdOrProject : projectIdOrProject.id)
    === SCRATCHPAD_PROJECT_ID
  );
}

export function mergeScratchpadProject(existingProjects: ProjectRecord[], scratchpadPath: string): ProjectRecord[] {
  const existingScratchpad = existingProjects.find((project) => isScratchpadProject(project));
  const scratchpadProject = createScratchpadProject(
    scratchpadPath,
    existingScratchpad?.addedAt ?? nowIso(),
  );

  return [
    scratchpadProject,
    ...existingProjects.filter((project) => !isScratchpadProject(project.id)),
  ];
}
