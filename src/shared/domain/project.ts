import { nowIso } from '@shared/utils/ids';

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  addedAt: string;
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
