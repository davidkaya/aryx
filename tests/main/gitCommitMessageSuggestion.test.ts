import { describe, expect, test } from 'bun:test';

import type { ProjectGitRunChangeSummary } from '@shared/domain/project';

import { buildProjectGitCommitMessageSuggestion } from '@main/git/gitCommitMessageSuggestion';

const baseSummary: ProjectGitRunChangeSummary = {
  generatedAt: '2026-03-31T00:00:00.000Z',
  branchAtStart: 'main',
  branchAtEnd: 'main',
  fileCount: 1,
  additions: 5,
  deletions: 2,
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
      origin: 'run-created',
      additions: 5,
      deletions: 2,
      canRevert: true,
    },
  ],
};

describe('buildProjectGitCommitMessageSuggestion', () => {
  test('infers a fix commit from the triggering user prompt', () => {
    const suggestion = buildProjectGitCommitMessageSuggestion({
      session: {
        title: 'Auth hardening',
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            authorName: 'You',
            content: 'Fix auth hardening for git integration.',
            createdAt: '2026-03-31T00:00:00.000Z',
          },
        ],
      },
      run: {
        triggerMessageId: 'msg-user-1',
      },
      summary: baseSummary,
    });

    expect(suggestion).toEqual({
      type: 'fix',
      subject: 'auth hardening for git integration',
      message: 'fix: auth hardening for git integration',
    });
  });

  test('infers docs commits from documentation-only changes', () => {
    const suggestion = buildProjectGitCommitMessageSuggestion({
      session: {
        title: 'Docs touch-up',
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            authorName: 'You',
            content: '',
            createdAt: '2026-03-31T00:00:00.000Z',
          },
        ],
      },
      run: {
        triggerMessageId: 'msg-user-1',
      },
      summary: {
        ...baseSummary,
        files: [
          {
            path: 'README.md',
            kind: 'modified',
            origin: 'run-created',
            additions: 1,
            deletions: 0,
            canRevert: true,
          },
        ],
      },
    });

    expect(suggestion.type).toBe('docs');
    expect(suggestion.message).toBe('docs: update readme');
  });
});
