import { nowIso } from '@shared/utils/ids';

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
