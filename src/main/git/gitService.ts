import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import type {
  ProjectGitChangeSummary,
  ProjectGitCommitSummary,
  ProjectGitContext,
  ProjectGitWorkingTreeFile,
  ProjectGitWorkingTreeFileStatus,
  ProjectGitWorkingTreeSnapshot,
} from '@shared/domain/project';
import { nowIso } from '@shared/utils/ids';

type ExecFileException = import('node:child_process').ExecFileException;

const require = createRequire(import.meta.url);
const { execFile } = require('node:child_process') as typeof import('node:child_process');
const execFileAsync = promisify(execFile);
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

function parseWorkingTreeFileStatus(value: string): ProjectGitWorkingTreeFileStatus | undefined {
  switch (value) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    case '?':
      return 'untracked';
    default:
      return undefined;
  }
}

function parseWorkingTreePath(rawPath: string): Pick<ProjectGitWorkingTreeFile, 'path' | 'previousPath'> {
  const separator = ' -> ';
  const separatorIndex = rawPath.indexOf(separator);
  if (separatorIndex < 0) {
    return { path: rawPath };
  }

  return {
    previousPath: rawPath.slice(0, separatorIndex).trim(),
    path: rawPath.slice(separatorIndex + separator.length).trim(),
  };
}

function parseWorkingTree(stdout: string): {
  changedFileCount: number;
  changes: ProjectGitChangeSummary;
  files: ProjectGitWorkingTreeFile[];
} {
  const summary: ProjectGitChangeSummary = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  const files: ProjectGitWorkingTreeFile[] = [];

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  let changedFileCount = 0;

  for (const line of lines) {
    if (line.startsWith('??')) {
      const path = line.slice(3).trim();
      if (!path) {
        continue;
      }

      summary.untracked += 1;
      changedFileCount += 1;
      files.push({
        path,
        unstagedStatus: 'untracked',
      });
      continue;
    }

    if (line.length < 3) {
      continue;
    }

    const x = line[0];
    const y = line[1];
    const rawPath = line.slice(3).trim();
    if (!rawPath) {
      continue;
    }

    changedFileCount += 1;
    const isConflicted = isConflictedStatus(x, y);
    const pathInfo = parseWorkingTreePath(rawPath);
    files.push({
      ...pathInfo,
      stagedStatus: parseWorkingTreeFileStatus(x),
      unstagedStatus: parseWorkingTreeFileStatus(y),
      ...(isConflicted ? { isConflicted: true } : {}),
    });

    if (isConflicted) {
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
    files,
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

    const { changedFileCount, changes } = parseWorkingTree(statusResult.stdout);
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

  async captureWorkingTreeSnapshot(
    projectPath: string,
    scannedAt = nowIso(),
  ): Promise<ProjectGitWorkingTreeSnapshot | undefined> {
    const repoRootResult = await this.tryRun(projectPath, ['rev-parse', '--show-toplevel']);
    if (!repoRootResult.ok) {
      return undefined;
    }

    const statusResult = await this.tryRun(projectPath, ['status', '--porcelain=1', '--untracked-files=all']);
    if (!statusResult.ok) {
      return undefined;
    }

    const branchResult = await this.tryRun(projectPath, ['branch', '--show-current']);
    const { changedFileCount, changes, files } = parseWorkingTree(statusResult.stdout);

    return {
      scannedAt,
      repoRoot: repoRootResult.stdout.trim(),
      branch: branchResult.ok ? parseBranch(branchResult.stdout) : undefined,
      changedFileCount,
      changes,
      files,
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
