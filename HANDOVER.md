# Git-aware context UX handover

This document covers the frontend/UX work that can now be built on top of the newly implemented backend/shared git-context support.

## What was implemented in backend/shared

The app now persists and refreshes per-project git context on `ProjectRecord`.

### New shared project shape

File: `src/shared/domain/project.ts`

`ProjectRecord` now has:

```ts
git?: ProjectGitContext;
```

`ProjectGitContext` shape:

```ts
type ProjectGitContextStatus = 'ready' | 'not-repository' | 'git-missing' | 'error';

interface ProjectGitContext {
  status: ProjectGitContextStatus;
  scannedAt: string;
  repoRoot?: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  isDirty?: boolean;
  changedFileCount?: number;
  changes?: {
    staged: number;
    unstaged: number;
    untracked: number;
    conflicted: number;
  };
  head?: {
    hash: string;
    shortHash: string;
    subject: string;
    committedAt: string;
  };
  errorMessage?: string;
}
```

### New backend behavior

Files:

- `src/main/git/gitService.ts`
- `src/main/EryxAppService.ts`

Behavior:

- when a project is added, git context is fetched immediately
- when the workspace loads, the main process schedules an initial git-context refresh for all projects
- scratchpad projects intentionally do not carry git context
- non-repo folders are represented explicitly with `status: 'not-repository'`
- missing system git is represented explicitly with `status: 'git-missing'`
- unexpected git failures are represented with `status: 'error'` plus `errorMessage`

### New Electron API

Files:

- `src/shared/contracts/channels.ts`
- `src/shared/contracts/ipc.ts`
- `src/main/ipc/registerIpcHandlers.ts`
- `src/preload/index.ts`

New API:

```ts
refreshProjectGitContext(projectId?: string): Promise<WorkspaceState>;
```

Notes:

- call with a `projectId` to refresh a single project
- call with no argument to refresh all projects
- the renderer also receives refreshed data through the existing `onWorkspaceUpdated(...)` subscription

## Important UX constraints and current backend semantics

These are important so the frontend does not guess incorrectly:

- `project.git` is optional overall because scratchpad has no git context and older persisted workspaces may not have been refreshed yet
- `status: 'ready'` is the only state where branch/dirty/commit details should be assumed to exist
- `branch` may still be missing even when `status === 'ready'` (for example detached HEAD)
- `head` may be missing even when `status === 'ready'` (for example a repo with no commits yet)
- `upstream`, `ahead`, and `behind` are optional and should only be shown when present
- `changedFileCount` is a file-entry count, while `changes` breaks it down into staged / unstaged / untracked / conflicted
- this phase does **not** inject git context into sidecar run-turn payloads yet; this is app/backend UI support, not orchestration/runtime support

## Recommended UX surfaces

### 1. Sidebar project rows

Primary file: `src/renderer/components/Sidebar.tsx`

Current `ProjectGroup` already renders:

- project icon
- project name
- running session count
- session count

Recommended additions for non-scratchpad projects:

- branch badge next to the project name when `project.git?.status === 'ready'`
- subtle dirty indicator when `isDirty === true`
- changed file count badge when `changedFileCount > 0`
- small warning/error badge for:
  - `not-repository`
  - `git-missing`
  - `error`
- refresh action for the selected or hovered project that calls `api.refreshProjectGitContext(project.id)`

Suggested behavior:

- keep the row compact; do not turn it into a full card
- prefer one-line metadata in the collapsed header and more detail in an expanded/hover area if needed
- scratchpad should remain visually distinct and should not show git affordances

### 2. Chat header / selected session context

Primary file: `src/renderer/components/ChatPane.tsx`

Current header already shows:

- project name
- pattern name
- pattern mode

Recommended additions for real projects:

- branch name beside the project title
- dirty state chip when the repo has pending changes
- optional compact summary like:
  - `3 changed`
  - `2 ahead`
  - `1 behind`
- optional recent commit summary tooltip/popover using `project.git.head`

This is likely the best place to make git context feel relevant to the active conversation without overcrowding the sidebar.

### 3. Empty/welcome state

Primary file: `src/renderer/components/WelcomePane.tsx`

Optional but useful:

- update copy so project-backed sessions clearly imply branch/diff awareness
- if you add a project-management callout, mention that git state appears automatically for repositories

### 4. App-level wiring

Primary file: `src/renderer/App.tsx`

The frontend agent will likely need to thread a refresh callback into whichever component gets the refresh UI, for example:

```ts
() => void api.refreshProjectGitContext(projectId)
```

No extra state container is required because the workspace subscription already updates the renderer.

## Suggested UX implementation order

1. Add a small git metadata presentation in `Sidebar.tsx`
2. Add selected-project git context in `ChatPane.tsx`
3. Wire refresh actions from `App.tsx`
4. Add polish for non-ready states (`not-repository`, `git-missing`, `error`)

## Edge cases the UX should handle

- scratchpad: no git UI at all
- project added outside a git repo: show a neutral non-repo state, not a scary error
- git missing on the machine: show a helpful message, not a broken state
- detached HEAD: do not assume `branch` exists; fall back to commit short hash if useful
- brand-new repo with no commits: `head` may be absent even though the repo is valid
- upstream not configured: do not show ahead/behind placeholders
- refresh while viewing the project: avoid layout jumps; optimistic spinners are fine

## Files most likely to change in the UX pass

- `src/renderer/App.tsx`
- `src/renderer/components/Sidebar.tsx`
- `src/renderer/components/ChatPane.tsx`
- `src/renderer/components/WelcomePane.tsx`

## Out of scope for this handover

These are intentionally **not** implemented yet in backend/runtime:

- passing git context into sidecar agent instructions
- git diff viewers or file-by-file change inspection
- branch switching or commit actions
- git-aware working sets / file pinning
- project summary generation beyond git metadata
