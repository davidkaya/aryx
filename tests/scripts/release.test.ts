import { describe, expect, test } from 'bun:test';

import {
  incrementVersion,
  parseReleaseBump,
  runReleaseWorkflow,
  type GitCommandResult,
  type ReleaseDependencies,
} from '../../scripts/release';

function gitSuccess(stdout = '', stderr = ''): GitCommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr,
  };
}

function gitFailure(exitCode = 1, stdout = '', stderr = ''): GitCommandResult {
  return {
    exitCode,
    stdout,
    stderr,
  };
}

function createReleaseDependencies(options?: {
  packageJsonText?: string;
  gitResults?: GitCommandResult[];
}) {
  let packageJsonText =
    options?.packageJsonText ??
    `{
  "name": "aryx",
  "version": "0.0.26"
}
`;

  const gitResults = [...(options?.gitResults ?? [])];
  const commands: string[][] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const logs: string[] = [];

  const dependencies: ReleaseDependencies = {
    readText: async () => packageJsonText,
    writeText: async (path, content) => {
      packageJsonText = content;
      writes.push({ path, content });
    },
    runGit: async (args) => {
      commands.push(args);
      const result = gitResults.shift();

      if (!result) {
        throw new Error(`Unexpected git command: ${args.join(' ')}`);
      }

      return result;
    },
    log: (message) => {
      logs.push(message);
    },
  };

  return {
    dependencies,
    commands,
    writes,
    logs,
    getPackageJsonText: () => packageJsonText,
  };
}

describe('release bump parsing', () => {
  test('defaults to patch when no bump argument is provided', () => {
    expect(parseReleaseBump()).toBe('patch');
  });

  test('rejects unsupported bump arguments', () => {
    expect(() => parseReleaseBump('prerelease')).toThrow(
      'Unsupported release bump "prerelease". Use patch, minor, or major.',
    );
  });
});

describe('version incrementing', () => {
  test('supports patch, minor, and major bumps', () => {
    expect(incrementVersion('0.0.26', 'patch')).toBe('0.0.27');
    expect(incrementVersion('0.0.26', 'minor')).toBe('0.1.0');
    expect(incrementVersion('0.0.26', 'major')).toBe('1.0.0');
  });
});

describe('release workflow', () => {
  test('bumps package.json, commits, tags, and pushes the tracked branch', async () => {
    const { dependencies, commands, writes, logs, getPackageJsonText } = createReleaseDependencies({
      gitResults: [
        gitSuccess(),
        gitSuccess('main\n'),
        gitSuccess('origin\n'),
        gitSuccess('refs/heads/main\n'),
        gitSuccess(),
        gitSuccess(),
        gitSuccess(),
        gitSuccess(),
        gitSuccess(),
      ],
    });

    const result = await runReleaseWorkflow(
      {
        repositoryRoot: 'C:\\workspace\\personal\\projects\\aryx',
        packageJsonPath: 'C:\\workspace\\personal\\projects\\aryx\\package.json',
      },
      dependencies,
    );

    expect(result).toMatchObject({
      bump: 'patch',
      currentVersion: '0.0.26',
      nextVersion: '0.0.27',
      tagName: 'v0.0.27',
      localBranch: 'main',
      remote: 'origin',
      upstreamBranch: 'main',
    });
    expect(writes).toHaveLength(1);
    expect(getPackageJsonText()).toContain('"version": "0.0.27"');
    expect(commands).toEqual([
      ['status', '--porcelain'],
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      ['config', '--get', 'branch.main.remote'],
      ['config', '--get', 'branch.main.merge'],
      ['tag', '--list', 'v0.0.27'],
      ['add', 'package.json'],
      ['commit', '-m', 'chore: release v0.0.27'],
      ['tag', '-a', 'v0.0.27', '-m', 'Release v0.0.27'],
      ['push', '--follow-tags', 'origin', 'HEAD:main'],
    ]);
    expect(logs).toEqual(['Released v0.0.27 from main to origin/main.']);
  });

  test('fails before writing package.json when the worktree is dirty', async () => {
    const { dependencies, commands, writes } = createReleaseDependencies({
      gitResults: [gitSuccess(' M README.md\n')],
    });

    await expect(
      runReleaseWorkflow(
        {
          repositoryRoot: 'C:\\workspace\\personal\\projects\\aryx',
          packageJsonPath: 'C:\\workspace\\personal\\projects\\aryx\\package.json',
        },
        dependencies,
      ),
    ).rejects.toThrow('Release requires a clean git worktree. Commit, stash, or discard changes first.');

    expect(writes).toHaveLength(0);
    expect(commands).toEqual([['status', '--porcelain']]);
  });

  test('fails before writing package.json when the next release tag already exists', async () => {
    const { dependencies, commands, writes } = createReleaseDependencies({
      gitResults: [
        gitSuccess(),
        gitSuccess('main\n'),
        gitSuccess('origin\n'),
        gitSuccess('refs/heads/main\n'),
        gitSuccess('v0.1.0\n'),
      ],
    });

    await expect(
      runReleaseWorkflow(
        {
          repositoryRoot: 'C:\\workspace\\personal\\projects\\aryx',
          packageJsonPath: 'C:\\workspace\\personal\\projects\\aryx\\package.json',
          bumpArg: 'minor',
        },
        dependencies,
      ),
    ).rejects.toThrow('Tag v0.1.0 already exists. Choose a different release version.');

    expect(writes).toHaveLength(0);
    expect(commands).toEqual([
      ['status', '--porcelain'],
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      ['config', '--get', 'branch.main.remote'],
      ['config', '--get', 'branch.main.merge'],
      ['tag', '--list', 'v0.1.0'],
    ]);
  });

  test('fails when the current branch does not have an upstream', async () => {
    const { dependencies, commands, writes } = createReleaseDependencies({
      gitResults: [
        gitSuccess(),
        gitSuccess('release\n'),
        gitFailure(),
        gitFailure(),
      ],
    });

    await expect(
      runReleaseWorkflow(
        {
          repositoryRoot: 'C:\\workspace\\personal\\projects\\aryx',
          packageJsonPath: 'C:\\workspace\\personal\\projects\\aryx\\package.json',
        },
        dependencies,
      ),
    ).rejects.toThrow('Release requires an upstream branch for release. Configure tracking before running the release helper.');

    expect(writes).toHaveLength(0);
    expect(commands).toEqual([
      ['status', '--porcelain'],
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      ['config', '--get', 'branch.release.remote'],
      ['config', '--get', 'branch.release.merge'],
    ]);
  });
});
