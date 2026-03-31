import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  test('captures a structured pre-run working tree snapshot', async () => {
    const service = createService({
      'rev-parse --show-toplevel': 'C:\\workspace\\repo\n',
      'status --porcelain=1 --untracked-files=all': 'R  src\\old.ts -> src\\new.ts\n M src\\app.ts\n?? notes.txt\nUU conflict.txt\n',
      'branch --show-current': 'feature/git-context\n',
    });

    await expect(service.captureWorkingTreeSnapshot('C:\\workspace\\repo', '2026-03-23T19:00:00.000Z')).resolves.toEqual({
      scannedAt: '2026-03-23T19:00:00.000Z',
      repoRoot: 'C:\\workspace\\repo',
      branch: 'feature/git-context',
      changedFileCount: 4,
      changes: {
        staged: 1,
        unstaged: 1,
        untracked: 1,
        conflicted: 1,
      },
      files: [
        {
          path: 'src\\new.ts',
          previousPath: 'src\\old.ts',
          stagedStatus: 'renamed',
          unstagedStatus: undefined,
        },
        {
          path: 'src\\app.ts',
          stagedStatus: undefined,
          unstagedStatus: 'modified',
        },
        {
          path: 'notes.txt',
          unstagedStatus: 'untracked',
        },
        {
          path: 'conflict.txt',
          stagedStatus: 'unmerged',
          unstagedStatus: 'unmerged',
          isConflicted: true,
        },
      ],
    });
  });

  test('returns no working tree snapshot outside a git repository', async () => {
    const service = createService({
      'rev-parse --show-toplevel': createGitError('fatal: not a git repository', {
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      }),
    });

    await expect(service.captureWorkingTreeSnapshot('C:\\workspace\\not-a-repo', '2026-03-23T19:00:00.000Z')).resolves.toBeUndefined();
  });

  test('captures baseline data for tracked diffs and untracked files', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'aryx-git-service-'));
    try {
      await writeFile(join(tempDirectory, 'notes.txt'), 'fresh notes\n', 'utf8');
      const service = createService({
        'diff --binary --no-ext-diff --no-renames HEAD -- src\\app.ts': 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
      });

      await expect(service.captureWorkingTreeBaseline(tempDirectory, {
        scannedAt: '2026-03-23T19:00:00.000Z',
        repoRoot: tempDirectory,
        branch: 'main',
        changedFileCount: 2,
        changes: {
          staged: 0,
          unstaged: 1,
          untracked: 1,
          conflicted: 0,
        },
        files: [
          {
            path: 'src\\app.ts',
            unstagedStatus: 'modified',
          },
          {
            path: 'notes.txt',
            unstagedStatus: 'untracked',
          },
        ],
      })).resolves.toEqual([
        {
          path: 'src\\app.ts',
          previousPath: undefined,
          combinedDiff: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
        },
        {
          path: 'notes.txt',
          previousPath: undefined,
          untrackedContentBase64: Buffer.from('fresh notes\n', 'utf8').toString('base64'),
        },
      ]);
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });

  test('describes git details with branches and recent commits', async () => {
    const service = createService({
      'rev-parse --show-toplevel': 'C:\\workspace\\repo\n',
      'status --porcelain=1 --untracked-files=all': ' M src\\app.ts\n',
      'branch --show-current': 'main\n',
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/main\n',
      'rev-list --left-right --count @{upstream}...HEAD': '0\t2\n',
      'log -1 --format=%H%n%h%n%s%n%cI': '0123456789abcdef\n0123456\nAdd git detail plumbing\n2026-03-23T18:00:00+01:00\n',
      'for-each-ref --format=%(refname:short)%00%(HEAD)%00%(upstream:short) refs/heads': 'main\0*\0origin/main\nfeature/refactor\0 \0origin/feature/refactor\n',
      'log -n15 --format=%H%x00%h%x00%an%x00%s%x00%cI%x00%D%x1e': '0123456789abcdef\x00123456\x00Alice\x00Add git detail plumbing\x002026-03-23T18:00:00+01:00\x00HEAD -> main, origin/main\x1e',
    });

    await expect(service.describeProjectGitDetails('C:\\workspace\\repo', '2026-03-23T19:00:00.000Z', 15)).resolves.toMatchObject({
      scannedAt: '2026-03-23T19:00:00.000Z',
      context: {
        status: 'ready',
        branch: 'main',
        upstream: 'origin/main',
        ahead: 2,
        behind: 0,
      },
      workingTree: {
        changedFileCount: 1,
      },
      branches: [
        { name: 'main', isCurrent: true, upstream: 'origin/main' },
        { name: 'feature/refactor', isCurrent: false, upstream: 'origin/feature/refactor' },
      ],
      recentCommits: [
        {
          hash: '0123456789abcdef',
          shortHash: '123456',
          authorName: 'Alice',
          subject: 'Add git detail plumbing',
          committedAt: '2026-03-23T18:00:00+01:00',
          refNames: 'HEAD -> main, origin/main',
        },
      ],
    });
  });

  test('dispatches commit workflow and branch commands to git', async () => {
    const executedCommands: string[] = [];
    const service = new GitService(async (_projectPath, args) => {
      executedCommands.push(args.join(' '));
      if (args.join(' ') === 'commit -m feat: update auth') {
        return '';
      }

      if (args.join(' ') === 'log -1 --format=%H%n%h%n%s%n%cI') {
        return 'fedcba9876543210\nfedcba9\nfeat: update auth\n2026-03-23T18:00:00+01:00\n';
      }

      return '';
    });

    await service.stageFiles('C:\\workspace\\repo', [{ path: 'src\\auth.ts' }]);
    await service.unstageFiles('C:\\workspace\\repo', [{ path: 'src\\auth.ts' }]);
    await expect(service.commit('C:\\workspace\\repo', 'feat: update auth')).resolves.toEqual({
      hash: 'fedcba9876543210',
      shortHash: 'fedcba9',
      subject: 'feat: update auth',
      committedAt: '2026-03-23T18:00:00+01:00',
    });
    await service.push('C:\\workspace\\repo');
    await service.fetch('C:\\workspace\\repo');
    await service.pull('C:\\workspace\\repo', true);
    await service.createBranch('C:\\workspace\\repo', 'feature/git-panel', undefined, true);
    await service.switchBranch('C:\\workspace\\repo', 'main');
    await service.deleteBranch('C:\\workspace\\repo', 'feature/git-panel', true);

    expect(executedCommands).toEqual([
      'add -- src\\auth.ts',
      'restore --staged -- src\\auth.ts',
      'commit -m feat: update auth',
      'log -1 --format=%H%n%h%n%s%n%cI',
      'push',
      'fetch --all --prune',
      'pull --rebase',
      'switch -c feature/git-panel',
      'switch main',
      'branch -D feature/git-panel',
    ]);
  });

  test('discards run-created untracked files from the working tree', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'aryx-git-discard-'));
    try {
      await writeFile(join(tempDirectory, 'notes.txt'), 'fresh notes\n', 'utf8');
      const executedCommands: string[] = [];
      const service = new GitService(async (_projectPath, args) => {
        executedCommands.push(args.join(' '));
        return '';
      });

      await service.discardRunChanges(tempDirectory, {
        summary: {
          generatedAt: '2026-03-31T00:00:00.000Z',
          branchAtStart: 'main',
          branchAtEnd: 'main',
          fileCount: 1,
          additions: 0,
          deletions: 0,
          counts: {
            added: 0,
            modified: 0,
            deleted: 0,
            renamed: 0,
            copied: 0,
            typeChanged: 0,
            unmerged: 0,
            untracked: 1,
            cleaned: 0,
          },
          files: [
            {
              path: 'notes.txt',
              kind: 'untracked',
              origin: 'run-created',
              additions: 0,
              deletions: 0,
              canRevert: true,
            },
          ],
        },
      });

      expect(executedCommands).toEqual([
        'rm --cached --force --ignore-unmatch -- notes.txt',
      ]);
      await expect(Bun.file(join(tempDirectory, 'notes.txt')).exists()).resolves.toBe(false);
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });

  test('restores cleaned pre-existing untracked files from the captured baseline', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'aryx-git-restore-'));
    try {
      const executedCommands: string[] = [];
      const service = new GitService(async (_projectPath, args) => {
        executedCommands.push(args.join(' '));
        return '';
      });

      await service.discardRunChanges(tempDirectory, {
        summary: {
          generatedAt: '2026-03-31T00:00:00.000Z',
          branchAtStart: 'main',
          branchAtEnd: 'main',
          fileCount: 1,
          additions: 0,
          deletions: 0,
          counts: {
            added: 0,
            modified: 0,
            deleted: 0,
            renamed: 0,
            copied: 0,
            typeChanged: 0,
            unmerged: 0,
            untracked: 0,
            cleaned: 1,
          },
          files: [
            {
              path: 'legacy.txt',
              kind: 'cleaned',
              origin: 'pre-existing',
              additions: 0,
              deletions: 0,
              canRevert: true,
            },
          ],
        },
        preRunBaselineFiles: [
          {
            path: 'legacy.txt',
            untrackedContentBase64: Buffer.from('legacy\n', 'utf8').toString('base64'),
          },
        ],
      });

      expect(executedCommands).toEqual([
        'restore --source=HEAD --staged --worktree -- legacy.txt',
      ]);
      await expect(Bun.file(join(tempDirectory, 'legacy.txt')).text()).resolves.toBe('legacy\n');
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });

  test('restores cleaned pre-existing empty untracked files from the captured baseline', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'aryx-git-restore-empty-'));
    try {
      const service = new GitService(async () => '');

      await service.discardRunChanges(tempDirectory, {
        summary: {
          generatedAt: '2026-03-31T00:00:00.000Z',
          branchAtStart: 'main',
          branchAtEnd: 'main',
          fileCount: 1,
          additions: 0,
          deletions: 0,
          counts: {
            added: 0,
            modified: 0,
            deleted: 0,
            renamed: 0,
            copied: 0,
            typeChanged: 0,
            unmerged: 0,
            untracked: 0,
            cleaned: 1,
          },
          files: [
            {
              path: 'empty.txt',
              kind: 'cleaned',
              origin: 'pre-existing',
              additions: 0,
              deletions: 0,
              canRevert: true,
            },
          ],
        },
        preRunBaselineFiles: [
          {
            path: 'empty.txt',
            untrackedContentBase64: '',
          },
        ],
      });

      await expect(Bun.file(join(tempDirectory, 'empty.txt')).text()).resolves.toBe('');
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });

  test('rejects restoring pre-existing files when no restorable baseline was captured', async () => {
    const service = new GitService(async () => '');

    await expect(service.discardRunChanges('C:\\workspace\\repo', {
      summary: {
        generatedAt: '2026-03-31T00:00:00.000Z',
        branchAtStart: 'main',
        branchAtEnd: 'main',
        fileCount: 1,
        additions: 0,
        deletions: 0,
        counts: {
          added: 0,
          modified: 1,
          deleted: 0,
          renamed: 0,
          copied: 0,
          typeChanged: 0,
          unmerged: 0,
          untracked: 0,
          cleaned: 0,
        },
        files: [
          {
            path: 'src\\auth.ts',
            kind: 'modified',
            origin: 'pre-existing',
            additions: 0,
            deletions: 0,
            canRevert: false,
          },
        ],
      },
      preRunBaselineFiles: [
        {
          path: 'src\\auth.ts',
        },
      ],
    })).rejects.toThrow('no restorable baseline was captured');
  });
});
