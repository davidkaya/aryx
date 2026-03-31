import { describe, expect, test } from 'bun:test';

import type { ProjectGitBaselineFile, ProjectGitWorkingTreeSnapshot } from '@shared/domain/project';

import { buildProjectGitRunChangeSummary } from '@main/git/gitRunChangeSummary';

const TIMESTAMP = '2026-03-31T00:00:00.000Z';

function createPreRunSnapshot(): ProjectGitWorkingTreeSnapshot {
  return {
    scannedAt: TIMESTAMP,
    repoRoot: 'C:\\workspace\\alpha',
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
        path: 'src\\auth.ts',
        unstagedStatus: 'modified',
      },
      {
        path: 'legacy.tmp',
        unstagedStatus: 'untracked',
      },
    ],
  };
}

function createPostRunSnapshot(): ProjectGitWorkingTreeSnapshot {
  return {
    scannedAt: TIMESTAMP,
    repoRoot: 'C:\\workspace\\alpha',
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
        path: 'src\\auth.ts',
        unstagedStatus: 'modified',
      },
      {
        path: 'notes.txt',
        unstagedStatus: 'untracked',
      },
    ],
  };
}

function createPreRunBaselines(): ProjectGitBaselineFile[] {
  return [
    {
      path: 'src\\auth.ts',
      combinedDiff: 'diff --git a/src/auth.ts b/src/auth.ts\n@@ -1 +1 @@\n-old\n+before\n',
    },
    {
      path: 'legacy.tmp',
      untrackedContentBase64: Buffer.from('legacy\n', 'utf8').toString('base64'),
    },
  ];
}

function createPostRunBaselines(): ProjectGitBaselineFile[] {
  return [
    {
      path: 'src\\auth.ts',
      combinedDiff: 'diff --git a/src/auth.ts b/src/auth.ts\n@@ -1 +1 @@\n-old\n+after\n',
    },
    {
      path: 'notes.txt',
      untrackedContentBase64: Buffer.from('fresh notes\n', 'utf8').toString('base64'),
    },
  ];
}

describe('buildProjectGitRunChangeSummary', () => {
  test('classifies run-created, pre-existing, and cleaned files', () => {
    const summary = buildProjectGitRunChangeSummary({
      generatedAt: TIMESTAMP,
      preRunSnapshot: createPreRunSnapshot(),
      preRunBaselineFiles: createPreRunBaselines(),
      postRunSnapshot: createPostRunSnapshot(),
      postRunBaselineFiles: createPostRunBaselines(),
    });

    expect(summary).toMatchObject({
      generatedAt: TIMESTAMP,
      branchAtStart: 'main',
      branchAtEnd: 'main',
      fileCount: 3,
      additions: 1,
      deletions: 1,
      counts: {
        added: 0,
        modified: 1,
        deleted: 0,
        renamed: 0,
        copied: 0,
        typeChanged: 0,
        unmerged: 0,
        untracked: 1,
        cleaned: 1,
      },
    });

    expect(summary?.files).toEqual([
      {
        path: 'notes.txt',
        previousPath: undefined,
        kind: 'untracked',
        origin: 'run-created',
        stagedStatus: undefined,
        unstagedStatus: 'untracked',
        additions: 0,
        deletions: 0,
        canRevert: true,
        preview: {
          path: 'notes.txt',
          previousPath: undefined,
          newFileContents: 'fresh notes\n',
        },
      },
      {
        path: 'legacy.tmp',
        previousPath: undefined,
        kind: 'cleaned',
        origin: 'pre-existing',
        stagedStatus: undefined,
        unstagedStatus: 'untracked',
        additions: 0,
        deletions: 0,
        canRevert: true,
        preview: {
          path: 'legacy.tmp',
          previousPath: undefined,
          newFileContents: 'legacy\n',
        },
      },
      {
        path: 'src\\auth.ts',
        previousPath: undefined,
        kind: 'modified',
        origin: 'pre-existing',
        stagedStatus: undefined,
        unstagedStatus: 'modified',
        additions: 1,
        deletions: 1,
        canRevert: true,
        preview: {
          path: 'src\\auth.ts',
          previousPath: undefined,
          diff: 'diff --git a/src/auth.ts b/src/auth.ts\n@@ -1 +1 @@\n-old\n+after\n',
        },
      },
    ]);
  });

  test('returns undefined when nothing changed across the run', () => {
    const snapshot = createPreRunSnapshot();
    const baselines = createPreRunBaselines();

    expect(buildProjectGitRunChangeSummary({
      generatedAt: TIMESTAMP,
      preRunSnapshot: snapshot,
      preRunBaselineFiles: baselines,
      postRunSnapshot: snapshot,
      postRunBaselineFiles: baselines,
    })).toBeUndefined();
  });

  test('marks pre-existing files as non-revertable when the baseline capture has no restore data', () => {
    const summary = buildProjectGitRunChangeSummary({
      generatedAt: TIMESTAMP,
      preRunSnapshot: createPreRunSnapshot(),
      preRunBaselineFiles: [
        {
          path: 'src\\auth.ts',
        },
      ],
      postRunSnapshot: createPostRunSnapshot(),
      postRunBaselineFiles: createPostRunBaselines(),
    });

    expect(summary?.files.find((file) => file.path === 'src\\auth.ts')).toMatchObject({
      path: 'src\\auth.ts',
      origin: 'pre-existing',
      canRevert: false,
    });

    expect(summary?.files.find((file) => file.path === 'legacy.tmp')).toMatchObject({
      path: 'legacy.tmp',
      kind: 'cleaned',
      canRevert: false,
    });
  });

  test('preserves empty untracked file previews', () => {
    const summary = buildProjectGitRunChangeSummary({
      generatedAt: TIMESTAMP,
      preRunSnapshot: {
        scannedAt: TIMESTAMP,
        repoRoot: 'C:\\workspace\\alpha',
        branch: 'main',
        changedFileCount: 1,
        changes: {
          staged: 0,
          unstaged: 0,
          untracked: 1,
          conflicted: 0,
        },
        files: [
          {
            path: 'empty.txt',
            unstagedStatus: 'untracked',
          },
        ],
      },
      preRunBaselineFiles: [
        {
          path: 'empty.txt',
          untrackedContentBase64: '',
        },
      ],
      postRunSnapshot: {
        scannedAt: TIMESTAMP,
        repoRoot: 'C:\\workspace\\alpha',
        branch: 'main',
        changedFileCount: 0,
        changes: {
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
        },
        files: [],
      },
      postRunBaselineFiles: [],
    });

    expect(summary?.files).toEqual([
      {
        path: 'empty.txt',
        previousPath: undefined,
        kind: 'cleaned',
        origin: 'pre-existing',
        stagedStatus: undefined,
        unstagedStatus: 'untracked',
        additions: 0,
        deletions: 0,
        canRevert: true,
        preview: {
          path: 'empty.txt',
          previousPath: undefined,
          newFileContents: '',
        },
      },
    ]);
  });
});
