import { isUtf8 } from 'node:buffer';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type {
  ProjectGitBaselineFile,
  ProjectGitBranchSummary,
  ProjectGitChangeSummary,
  ProjectGitCommitLogEntry,
  ProjectGitCommitSummary,
  ProjectGitContext,
  ProjectGitDetails,
  ProjectGitDiffPreview,
  ProjectGitFileReference,
  ProjectGitRunChangeSummary,
  ProjectGitRunChangedFile,
  ProjectGitWorkingTreeFile,
  ProjectGitWorkingTreeFileStatus,
  ProjectGitWorkingTreeSnapshot,
} from '@shared/domain/project';
import { nowIso } from '@shared/utils/ids';

import { buildProjectGitRunChangeSummary } from '@main/git/gitRunChangeSummary';

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

function isUnknownPathspec(error: GitCommandFailure): boolean {
  const detail = `${error.message}\n${error.stderr ?? ''}`.toLowerCase();
  return detail.includes('did not match any file') || detail.includes('pathspec');
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

function parseBranchList(stdout: string): ProjectGitBranchSummary[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [name, currentMarker, upstream] = line.split('\0');
      const trimmedName = name?.trim();
      if (!trimmedName) {
        return [];
      }

      return [{
        name: trimmedName,
        isCurrent: currentMarker?.trim() === '*',
        upstream: upstream?.trim() || undefined,
      }];
    });
}

function parseCommitLog(stdout: string): ProjectGitCommitLogEntry[] {
  return stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [hash, shortHash, authorName, subject, committedAt, refNames] = record.split('\0');
      if (!hash || !shortHash || !authorName || !subject || !committedAt) {
        return [];
      }

      return [{
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        authorName: authorName.trim(),
        subject: subject.trim(),
        committedAt: committedAt.trim(),
        refNames: refNames?.trim() || undefined,
      }];
    });
}

function isPureUntrackedFile(file: ProjectGitWorkingTreeFile): boolean {
  return file.stagedStatus === undefined && file.unstagedStatus === 'untracked';
}

function buildGitPaths(file: ProjectGitFileReference): string[] {
  const paths = new Set<string>();
  if (file.previousPath?.trim()) {
    paths.add(file.previousPath.trim());
  }
  if (file.path.trim()) {
    paths.add(file.path.trim());
  }

  return [...paths];
}

function uniqueGitPaths(files: readonly ProjectGitFileReference[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    for (const path of buildGitPaths(file)) {
      paths.add(path);
    }
  }

  return [...paths];
}

function isBinaryDiff(diff: string | undefined): boolean {
  if (!diff) {
    return false;
  }

  return diff.includes('GIT binary patch') || diff.includes('Binary files ');
}

function canRestoreBaseline(
  baseline: ProjectGitBaselineFile | undefined,
): baseline is ProjectGitBaselineFile {
  return baseline !== undefined
    && (baseline.untrackedContentBase64 !== undefined || baseline.combinedDiff !== undefined);
}

function baselineToPreview(
  file: Pick<ProjectGitFileReference, 'path' | 'previousPath'>,
  baseline: ProjectGitBaselineFile | undefined,
): ProjectGitDiffPreview | undefined {
  if (!baseline) {
    return undefined;
  }

  if (baseline.untrackedContentBase64 !== undefined) {
    const contentBuffer = Buffer.from(baseline.untrackedContentBase64, 'base64');
    return {
      path: file.path,
      previousPath: file.previousPath,
      ...(isUtf8(contentBuffer) ? { newFileContents: contentBuffer.toString('utf8') } : {}),
      ...(baseline.isBinary ? { isBinary: true } : {}),
    };
  }

  if (baseline.combinedDiff === undefined && baseline.isBinary !== true) {
    return undefined;
  }

  return {
    path: file.path,
    previousPath: file.previousPath,
    ...(baseline.combinedDiff && !isBinaryDiff(baseline.combinedDiff)
      ? { diff: baseline.combinedDiff }
      : {}),
    ...(baseline.isBinary || isBinaryDiff(baseline.combinedDiff) ? { isBinary: true } : {}),
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

  async describeProjectGitDetails(
    projectPath: string,
    scannedAt = nowIso(),
    commitLimit = 20,
  ): Promise<ProjectGitDetails> {
    const context = await this.describeProject(projectPath, scannedAt);
    if (context.status !== 'ready') {
      return {
        scannedAt,
        context,
        branches: [],
        recentCommits: [],
      };
    }

    const [workingTree, branches, recentCommits] = await Promise.all([
      this.captureWorkingTreeSnapshot(projectPath, scannedAt),
      this.listBranches(projectPath),
      this.listRecentCommits(projectPath, commitLimit),
    ]);

    return {
      scannedAt,
      context,
      workingTree: workingTree ?? undefined,
      branches,
      recentCommits,
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

  async captureWorkingTreeBaseline(
    projectPath: string,
    snapshot?: ProjectGitWorkingTreeSnapshot,
  ): Promise<ProjectGitBaselineFile[]> {
    const effectiveSnapshot = snapshot ?? await this.captureWorkingTreeSnapshot(projectPath);
    if (!effectiveSnapshot || effectiveSnapshot.files.length === 0) {
      return [];
    }

    const baselineFiles = await Promise.all(
      effectiveSnapshot.files.map((file) => this.captureBaselineFile(projectPath, file)),
    );

    return baselineFiles.flatMap((file) => (file ? [file] : []));
  }

  async computeRunChangeSummary(
    projectPath: string,
    options: {
      generatedAt?: string;
      preRunSnapshot?: ProjectGitWorkingTreeSnapshot;
      preRunBaselineFiles?: readonly ProjectGitBaselineFile[];
    },
  ): Promise<ProjectGitRunChangeSummary | undefined> {
    const generatedAt = options.generatedAt ?? nowIso();
    const postRunSnapshot = await this.captureWorkingTreeSnapshot(projectPath, generatedAt);
    if (!options.preRunSnapshot || !postRunSnapshot) {
      return undefined;
    }

    const postRunBaselineFiles = await this.captureWorkingTreeBaseline(projectPath, postRunSnapshot);
    return buildProjectGitRunChangeSummary({
      generatedAt,
      preRunSnapshot: options.preRunSnapshot,
      preRunBaselineFiles: options.preRunBaselineFiles,
      postRunSnapshot,
      postRunBaselineFiles,
    });
  }

  async getWorkingTreeFilePreview(
    projectPath: string,
    file: ProjectGitFileReference,
  ): Promise<ProjectGitDiffPreview | undefined> {
    const snapshot = await this.captureWorkingTreeSnapshot(projectPath);
    if (!snapshot) {
      return undefined;
    }

    const matchedFile = snapshot.files.find((candidate) =>
      candidate.path === file.path
      || candidate.previousPath === file.path
      || (file.previousPath !== undefined && candidate.path === file.previousPath)
      || (file.previousPath !== undefined && candidate.previousPath === file.previousPath));
    if (!matchedFile) {
      return undefined;
    }

    const baseline = await this.captureBaselineFile(projectPath, matchedFile);
    return baselineToPreview(matchedFile, baseline);
  }

  async stageFiles(projectPath: string, files: readonly ProjectGitFileReference[]): Promise<void> {
    const paths = uniqueGitPaths(files);
    if (paths.length === 0) {
      return;
    }

    await this.run(projectPath, ['add', '--', ...paths]);
  }

  async unstageFiles(projectPath: string, files: readonly ProjectGitFileReference[]): Promise<void> {
    const paths = uniqueGitPaths(files);
    if (paths.length === 0) {
      return;
    }

    await this.run(projectPath, ['restore', '--staged', '--', ...paths]);
  }

  async commit(projectPath: string, message: string): Promise<ProjectGitCommitSummary> {
    await this.run(projectPath, ['commit', '-m', message]);
    const head = await this.getHeadCommit(projectPath);
    if (!head) {
      throw new Error('Git commit completed, but the new HEAD commit could not be resolved.');
    }

    return head;
  }

  async push(projectPath: string): Promise<void> {
    await this.run(projectPath, ['push']);
  }

  async fetch(projectPath: string): Promise<void> {
    await this.run(projectPath, ['fetch', '--all', '--prune']);
  }

  async pull(projectPath: string, rebase = false): Promise<void> {
    await this.run(projectPath, rebase ? ['pull', '--rebase'] : ['pull']);
  }

  async createBranch(
    projectPath: string,
    name: string,
    startPoint?: string,
    checkout = true,
  ): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('A branch name is required.');
    }

    if (checkout) {
      await this.run(
        projectPath,
        ['switch', '-c', trimmedName, ...(startPoint?.trim() ? [startPoint.trim()] : [])],
      );
      return;
    }

    await this.run(
      projectPath,
      ['branch', trimmedName, ...(startPoint?.trim() ? [startPoint.trim()] : [])],
    );
  }

  async switchBranch(projectPath: string, name: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('A branch name is required.');
    }

    await this.run(projectPath, ['switch', trimmedName]);
  }

  async deleteBranch(projectPath: string, name: string, force = false): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('A branch name is required.');
    }

    await this.run(projectPath, ['branch', force ? '-D' : '-d', trimmedName]);
  }

  async listBranches(projectPath: string): Promise<ProjectGitBranchSummary[]> {
    const result = await this.tryRun(projectPath, [
      'for-each-ref',
      '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)',
      'refs/heads',
    ]);

    return result.ok ? parseBranchList(result.stdout) : [];
  }

  async listRecentCommits(projectPath: string, limit = 20): Promise<ProjectGitCommitLogEntry[]> {
    const result = await this.tryRun(projectPath, [
      'log',
      `-n${Math.max(1, Math.round(limit))}`,
      '--format=%H%x00%h%x00%an%x00%s%x00%cI%x00%D%x1e',
    ]);

    return result.ok ? parseCommitLog(result.stdout) : [];
  }

  async discardRunChanges(
    projectPath: string,
    options: {
      summary: ProjectGitRunChangeSummary;
      preRunBaselineFiles?: readonly ProjectGitBaselineFile[];
      files?: readonly ProjectGitFileReference[];
    },
  ): Promise<void> {
    const selectedFiles = options.files && options.files.length > 0
      ? options.summary.files.filter((candidate) =>
          options.files?.some((selected) =>
            selected.path === candidate.path
            || selected.path === candidate.previousPath
            || (selected.previousPath !== undefined && selected.previousPath === candidate.previousPath)))
      : options.summary.files;
    if (selectedFiles.length === 0) {
      return;
    }

    const baselinesByPath = new Map(
      (options.preRunBaselineFiles ?? []).map((file) => [file.path, file] satisfies [string, ProjectGitBaselineFile]),
    );

    for (const file of selectedFiles) {
      if (file.origin === 'pre-existing') {
        if (!file.canRevert) {
          throw new Error(`Cannot restore "${file.path}" to its pre-run state because no restorable baseline was captured.`);
        }

        const baseline = baselinesByPath.get(file.previousPath ?? file.path) ?? baselinesByPath.get(file.path);
        if (!canRestoreBaseline(baseline)) {
          throw new Error(`Cannot restore "${file.path}" to its pre-run state because no restorable baseline was captured.`);
        }

        await this.restorePreExistingChange(projectPath, file, baseline);
        continue;
      }

      await this.restoreRunCreatedChange(projectPath, file);
    }
  }

  private async captureBaselineFile(
    projectPath: string,
    file: ProjectGitWorkingTreeFile,
  ): Promise<ProjectGitBaselineFile | undefined> {
    if (!file.path.trim()) {
      return undefined;
    }

    if (isPureUntrackedFile(file)) {
      try {
        const contents = await readFile(join(projectPath, file.path));
        return {
          path: file.path,
          previousPath: file.previousPath,
          untrackedContentBase64: contents.toString('base64'),
          ...(isUtf8(contents) ? {} : { isBinary: true }),
        };
      } catch {
        return {
          path: file.path,
          previousPath: file.previousPath,
        };
      }
    }

    const diffPaths = buildGitPaths(file);
    const diffResult = await this.tryRun(projectPath, [
      'diff',
      '--binary',
      '--no-ext-diff',
      '--no-renames',
      'HEAD',
      '--',
      ...diffPaths,
    ]);
    if (!diffResult.ok) {
      return {
        path: file.path,
        previousPath: file.previousPath,
      };
    }

    return {
      path: file.path,
      previousPath: file.previousPath,
      combinedDiff: diffResult.stdout.trim() ? diffResult.stdout : undefined,
      ...(isBinaryDiff(diffResult.stdout) ? { isBinary: true } : {}),
    };
  }

  private async getHeadCommit(projectPath: string): Promise<ProjectGitCommitSummary | undefined> {
    const result = await this.tryRun(projectPath, ['log', '-1', '--format=%H%n%h%n%s%n%cI']);
    return result.ok ? parseHead(result.stdout) : undefined;
  }

  private async restoreRunCreatedChange(
    projectPath: string,
    file: ProjectGitRunChangedFile,
  ): Promise<void> {
    if (file.kind === 'renamed' && file.previousPath) {
      await this.restorePathFromHead(projectPath, file.previousPath);
      await this.removePath(projectPath, file.path);
      return;
    }

    if (file.kind === 'added' || file.kind === 'untracked' || file.kind === 'copied') {
      await this.removePath(projectPath, file.path);
      return;
    }

    await this.restorePathFromHead(projectPath, file.path);
  }

  private async restorePreExistingChange(
    projectPath: string,
    file: ProjectGitRunChangedFile,
    baseline: ProjectGitBaselineFile,
  ): Promise<void> {
    await this.restorePathFromHead(projectPath, baseline.path);
    if (file.path !== baseline.path) {
      await this.removePath(projectPath, file.path);
    }

    if (baseline.untrackedContentBase64 !== undefined) {
      const contents = Buffer.from(baseline.untrackedContentBase64, 'base64');
      await mkdir(dirname(join(projectPath, baseline.path)), { recursive: true });
      await writeFile(join(projectPath, baseline.path), contents);
      return;
    }

    if (baseline.combinedDiff) {
      await this.applyPatch(projectPath, baseline.combinedDiff);
    }
  }

  private async restorePathFromHead(projectPath: string, path: string): Promise<void> {
    const result = await this.tryRun(projectPath, ['restore', '--source=HEAD', '--staged', '--worktree', '--', path]);
    if (!result.ok && !isUnknownPathspec(result.error)) {
      throw result.error;
    }
  }

  private async removePath(projectPath: string, path: string): Promise<void> {
    const unstageResult = await this.tryRun(projectPath, ['rm', '--cached', '--force', '--ignore-unmatch', '--', path]);
    if (!unstageResult.ok && !isUnknownPathspec(unstageResult.error)) {
      throw unstageResult.error;
    }

    await rm(join(projectPath, path), { force: true });
  }

  private async applyPatch(projectPath: string, diff: string): Promise<void> {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'aryx-git-patch-'));
    const patchPath = join(tempDirectory, 'restore.diff');
    try {
      await writeFile(patchPath, diff, 'utf8');
      await this.run(projectPath, ['apply', '--whitespace=nowarn', '--recount', patchPath]);
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  }

  private async run(projectPath: string, args: string[]): Promise<string> {
    try {
      return await this.runGitCommand(projectPath, args);
    } catch (error) {
      throw createGitCommandFailure(projectPath, args, error);
    }
  }

  private async tryRun(projectPath: string, args: string[]): Promise<GitCommandResult> {
    try {
      return {
        ok: true,
        stdout: await this.run(projectPath, args),
      };
    } catch (error) {
      return {
        ok: false,
        error: createGitCommandFailure(projectPath, args, error),
      };
    }
  }
}
