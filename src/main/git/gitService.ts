import childProcess, { type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProjectGitChangeSummary, ProjectGitCommitSummary, ProjectGitContext } from '@shared/domain/project';
import { nowIso } from '@shared/utils/ids';

const execFileAsync = promisify(childProcess.execFile);
const GIT_TIMEOUT_MS = 5_000;

type GitCommandRunner = (projectPath: string, args: string[]) => Promise<string>;

type GitCommandResult =
  | { ok: true; stdout: string }
  | { ok: false; error: GitCommandFailure };

class GitCommandFailure extends Error {
  readonly code?: number | string;
  readonly stderr?: string;

  constructor(message: string, options?: { code?: number | string; stderr?: string; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'GitCommandFailure';
    this.code = options?.code;
    this.stderr = options?.stderr;
  }
}

function createGitCommandFailure(
  projectPath: string,
  args: string[],
  error: unknown,
): GitCommandFailure {
  if (error instanceof GitCommandFailure) {
    return error;
  }

  const execError = error as ExecFileException & { stderr?: string };
  const command = `git -C "${projectPath}" ${args.join(' ')}`.trim();
  const stderr = typeof execError?.stderr === 'string' ? execError.stderr.trim() : undefined;
  const message = stderr || execError?.message || `Git command failed: ${command}`;

  return new GitCommandFailure(message, {
    code: execError?.code ?? undefined,
    stderr,
    cause: error,
  });
}

async function defaultGitCommandRunner(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });

    return stdout;
  } catch (error) {
    throw createGitCommandFailure(projectPath, args, error);
  }
}

function isGitMissing(error: GitCommandFailure): boolean {
  return error.code === 'ENOENT';
}

function isNotRepository(error: GitCommandFailure): boolean {
  const detail = `${error.message}\n${error.stderr ?? ''}`.toLowerCase();
  return detail.includes('not a git repository');
}

function summarizeGitFailure(error: GitCommandFailure): string {
  return error.stderr?.trim() || error.message;
}

function parseBranch(stdout: string): string | undefined {
  const branch = stdout.trim();
  return branch || undefined;
}

function parseAheadBehind(stdout: string): Pick<ProjectGitContext, 'ahead' | 'behind'> {
  const [behindValue, aheadValue] = stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindValue ?? '', 10);
  const ahead = Number.parseInt(aheadValue ?? '', 10);

  return {
    ahead: Number.isFinite(ahead) ? ahead : undefined,
    behind: Number.isFinite(behind) ? behind : undefined,
  };
}

function isConflictedStatus(x: string, y: string): boolean {
  return (
    x === 'U'
    || y === 'U'
    || (x === 'A' && y === 'A')
    || (x === 'D' && y === 'D')
  );
}

function parseChangeSummary(stdout: string): {
  changedFileCount: number;
  changes: ProjectGitChangeSummary;
} {
  const summary: ProjectGitChangeSummary = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  let changedFileCount = 0;

  for (const line of lines) {
    if (line.startsWith('??')) {
      summary.untracked += 1;
      changedFileCount += 1;
      continue;
    }

    if (line.length < 2) {
      continue;
    }

    const x = line[0];
    const y = line[1];
    changedFileCount += 1;

    if (isConflictedStatus(x, y)) {
      summary.conflicted += 1;
      continue;
    }

    if (x !== ' ') {
      summary.staged += 1;
    }

    if (y !== ' ') {
      summary.unstaged += 1;
    }
  }

  return {
    changedFileCount,
    changes: summary,
  };
}

function parseHead(stdout: string): ProjectGitCommitSummary | undefined {
  const [hash, shortHash, subject, committedAt] = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!hash || !shortHash || !subject || !committedAt) {
    return undefined;
  }

  return {
    hash,
    shortHash,
    subject,
    committedAt,
  };
}

export class GitService {
  constructor(private readonly runGitCommand: GitCommandRunner = defaultGitCommandRunner) {}

  async describeProject(projectPath: string, scannedAt = nowIso()): Promise<ProjectGitContext> {
    const repoRootResult = await this.tryRun(projectPath, ['rev-parse', '--show-toplevel']);
    if (!repoRootResult.ok) {
      if (isGitMissing(repoRootResult.error)) {
        return {
          status: 'git-missing',
          scannedAt,
          errorMessage: 'Git is not installed or is not available on PATH.',
        };
      }

      if (isNotRepository(repoRootResult.error)) {
        return {
          status: 'not-repository',
          scannedAt,
        };
      }

      return {
        status: 'error',
        scannedAt,
        errorMessage: summarizeGitFailure(repoRootResult.error),
      };
    }

    const repoRoot = repoRootResult.stdout.trim();
    const statusResult = await this.tryRun(projectPath, ['status', '--porcelain=1', '--untracked-files=all']);
    if (!statusResult.ok) {
      return {
        status: 'error',
        scannedAt,
        repoRoot,
        errorMessage: summarizeGitFailure(statusResult.error),
      };
    }

    const [branchResult, upstreamResult, countsResult, headResult] = await Promise.all([
      this.tryRun(projectPath, ['branch', '--show-current']),
      this.tryRun(projectPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      this.tryRun(projectPath, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
      this.tryRun(projectPath, ['log', '-1', '--format=%H%n%h%n%s%n%cI']),
    ]);

    const { changedFileCount, changes } = parseChangeSummary(statusResult.stdout);
    const upstream = upstreamResult.ok ? upstreamResult.stdout.trim() || undefined : undefined;
    const aheadBehind = countsResult.ok ? parseAheadBehind(countsResult.stdout) : {};

    return {
      status: 'ready',
      scannedAt,
      repoRoot,
      branch: branchResult.ok ? parseBranch(branchResult.stdout) : undefined,
      upstream,
      ahead: upstream ? aheadBehind.ahead : undefined,
      behind: upstream ? aheadBehind.behind : undefined,
      isDirty: changedFileCount > 0,
      changedFileCount,
      changes,
      head: headResult.ok ? parseHead(headResult.stdout) : undefined,
    };
  }

  private async tryRun(projectPath: string, args: string[]): Promise<GitCommandResult> {
    try {
      return {
        ok: true,
        stdout: await this.runGitCommand(projectPath, args),
      };
    } catch (error) {
      return {
        ok: false,
        error: createGitCommandFailure(projectPath, args, error),
      };
    }
  }
}
