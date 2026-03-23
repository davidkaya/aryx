import { describe, expect, test } from 'bun:test';

import { GitService } from '@main/git/gitService';

function createGitError(message: string, options?: { code?: number | string; stderr?: string }) {
  return Object.assign(new Error(message), options);
}

function createService(responses: Record<string, string | Error>) {
  return new GitService(async (_projectPath, args) => {
    const key = args.join(' ');
    const response = responses[key];

    if (response === undefined) {
      throw new Error(`Unexpected git command: ${key}`);
    }

    if (response instanceof Error) {
      throw response;
    }

    return response;
  });
}

describe('GitService', () => {
  test('describes a git repository with branch, dirty state, change counts, and head commit summary', async () => {
    const service = createService({
      'rev-parse --show-toplevel': 'C:\\workspace\\repo\n',
      'status --porcelain=1 --untracked-files=all': 'M  README.md\n M src\\app.ts\n?? notes.txt\nUU conflict.txt\n',
      'branch --show-current': 'feature/git-context\n',
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/feature/git-context\n',
      'rev-list --left-right --count @{upstream}...HEAD': '2\t1\n',
      'log -1 --format=%H%n%h%n%s%n%cI': '0123456789abcdef\n0123456\nAdd git context plumbing\n2026-03-23T18:00:00+01:00\n',
    });

    await expect(service.describeProject('C:\\workspace\\repo', '2026-03-23T19:00:00.000Z')).resolves.toEqual({
      status: 'ready',
      scannedAt: '2026-03-23T19:00:00.000Z',
      repoRoot: 'C:\\workspace\\repo',
      branch: 'feature/git-context',
      upstream: 'origin/feature/git-context',
      ahead: 1,
      behind: 2,
      isDirty: true,
      changedFileCount: 4,
      changes: {
        staged: 1,
        unstaged: 1,
        untracked: 1,
        conflicted: 1,
      },
      head: {
        hash: '0123456789abcdef',
        shortHash: '0123456',
        subject: 'Add git context plumbing',
        committedAt: '2026-03-23T18:00:00+01:00',
      },
    });
  });

  test('reports non-repository paths explicitly', async () => {
    const service = createService({
      'rev-parse --show-toplevel': createGitError('fatal: not a git repository', {
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      }),
    });

    await expect(service.describeProject('C:\\workspace\\not-a-repo', '2026-03-23T19:00:00.000Z')).resolves.toEqual({
      status: 'not-repository',
      scannedAt: '2026-03-23T19:00:00.000Z',
    });
  });

  test('reports missing git binary explicitly', async () => {
    const service = createService({
      'rev-parse --show-toplevel': createGitError('spawn git ENOENT', {
        code: 'ENOENT',
      }),
    });

    await expect(service.describeProject('C:\\workspace\\repo', '2026-03-23T19:00:00.000Z')).resolves.toEqual({
      status: 'git-missing',
      scannedAt: '2026-03-23T19:00:00.000Z',
      errorMessage: 'Git is not installed or is not available on PATH.',
    });
  });

  test('returns partial ready context when upstream or head commit are unavailable', async () => {
    const service = createService({
      'rev-parse --show-toplevel': 'C:\\workspace\\repo\n',
      'status --porcelain=1 --untracked-files=all': '',
      'branch --show-current': 'main\n',
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': createGitError('fatal: no upstream configured', {
        stderr: 'fatal: no upstream configured for branch \'main\'',
      }),
      'rev-list --left-right --count @{upstream}...HEAD': createGitError('fatal: no upstream configured', {
        stderr: 'fatal: no upstream configured for branch \'main\'',
      }),
      'log -1 --format=%H%n%h%n%s%n%cI': createGitError('fatal: your current branch does not have any commits yet', {
        stderr: 'fatal: your current branch does not have any commits yet',
      }),
    });

    await expect(service.describeProject('C:\\workspace\\repo', '2026-03-23T19:00:00.000Z')).resolves.toEqual({
      status: 'ready',
      scannedAt: '2026-03-23T19:00:00.000Z',
      repoRoot: 'C:\\workspace\\repo',
      branch: 'main',
      upstream: undefined,
      ahead: undefined,
      behind: undefined,
      isDirty: false,
      changedFileCount: 0,
      changes: {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
      },
      head: undefined,
    });
  });
});
