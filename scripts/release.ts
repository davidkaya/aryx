import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const packageJsonPath = resolve(repositoryRoot, 'package.json');

export type ReleaseBump = 'patch' | 'minor' | 'major';

interface PackageJsonShape {
  version?: unknown;
  [key: string]: unknown;
}

export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[]) => Promise<GitCommandResult>;

export interface ReleaseDependencies {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  runGit: GitRunner;
  log(message: string): void;
}

export interface ReleaseWorkflowOptions {
  repositoryRoot: string;
  packageJsonPath: string;
  bumpArg?: string;
}

export interface ReleaseResult {
  bump: ReleaseBump;
  currentVersion: string;
  nextVersion: string;
  tagName: string;
  localBranch: string;
  remote: string;
  upstreamBranch: string;
}

interface UpstreamTarget {
  remote: string;
  branch: string;
}

function createGitRunner(cwd: string): GitRunner {
  return async (args) =>
    new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', rejectPromise);
      child.on('close', (code, signal) => {
        if (signal) {
          rejectPromise(new Error(`git ${args.join(' ')} exited because of signal ${signal}.`));
          return;
        }

        resolvePromise({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
}

function createReleaseDependencies(cwd: string): ReleaseDependencies {
  return {
    readText: (path) => readFile(path, 'utf8'),
    writeText: (path, content) => writeFile(path, content, 'utf8'),
    runGit: createGitRunner(cwd),
    log: console.log,
  };
}

function parsePackageJson(packageJsonText: string): PackageJsonShape {
  try {
    return JSON.parse(packageJsonText) as PackageJsonShape;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse package.json: ${message}`);
  }
}

export function parseReleaseBump(value?: string): ReleaseBump {
  if (value === undefined) {
    return 'patch';
  }

  if (value === 'patch' || value === 'minor' || value === 'major') {
    return value;
  }

  throw new Error(`Unsupported release bump "${value}". Use patch, minor, or major.`);
}

export function readPackageVersion(packageJsonText: string): string {
  const packageJson = parsePackageJson(packageJsonText);

  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json is missing a string version field.');
  }

  return packageJson.version;
}

function parseSemver(version: string): [number, number, number] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);

  if (!match) {
    throw new Error(`Unsupported version "${version}". Expected a simple x.y.z semantic version.`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function incrementVersion(version: string, bump: ReleaseBump): string {
  const [major, minor, patch] = parseSemver(version);

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function detectNewline(packageJsonText: string): '\r\n' | '\n' {
  return packageJsonText.includes('\r\n') ? '\r\n' : '\n';
}

export function updatePackageJsonVersion(packageJsonText: string, nextVersion: string): string {
  const newline = detectNewline(packageJsonText);
  const packageJson = parsePackageJson(packageJsonText);

  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json is missing a string version field.');
  }

  packageJson.version = nextVersion;

  return `${JSON.stringify(packageJson, null, 2).replace(/\n/g, newline)}${newline}`;
}

function formatGitFailure(args: string[], result: GitCommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();

  if (detail.length > 0) {
    return `git ${args.join(' ')} failed: ${detail}`;
  }

  return `git ${args.join(' ')} failed with exit code ${result.exitCode}.`;
}

async function runGitOrThrow(runGit: GitRunner, args: string[], context: string): Promise<GitCommandResult> {
  const result = await runGit(args);

  if (result.exitCode !== 0) {
    throw new Error(`${context} ${formatGitFailure(args, result)}`);
  }

  return result;
}

async function ensureCleanWorktree(runGit: GitRunner): Promise<void> {
  const result = await runGitOrThrow(runGit, ['status', '--porcelain'], 'Could not inspect the current git worktree.');

  if (result.stdout.trim().length > 0) {
    throw new Error('Release requires a clean git worktree. Commit, stash, or discard changes first.');
  }
}

async function resolveLocalBranch(runGit: GitRunner): Promise<string> {
  const result = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);

  if (result.exitCode !== 0) {
    throw new Error('Release requires a checked-out branch. Detached HEAD is not supported.');
  }

  const branch = result.stdout.trim();

  if (branch.length === 0) {
    throw new Error('Release could not determine the current branch name.');
  }

  return branch;
}

function normalizeUpstreamBranch(mergeRef: string): string {
  const prefix = 'refs/heads/';

  if (!mergeRef.startsWith(prefix)) {
    throw new Error(`Release expected an upstream branch ref, received "${mergeRef}".`);
  }

  return mergeRef.slice(prefix.length);
}

async function resolveUpstreamTarget(runGit: GitRunner, localBranch: string): Promise<UpstreamTarget> {
  const remoteResult = await runGit(['config', '--get', `branch.${localBranch}.remote`]);
  const mergeResult = await runGit(['config', '--get', `branch.${localBranch}.merge`]);

  if (remoteResult.exitCode !== 0 || mergeResult.exitCode !== 0) {
    throw new Error(`Release requires an upstream branch for ${localBranch}. Configure tracking before running the release helper.`);
  }

  const remote = remoteResult.stdout.trim();
  const mergeRef = mergeResult.stdout.trim();

  if (remote.length === 0 || mergeRef.length === 0) {
    throw new Error(`Release requires an upstream branch for ${localBranch}. Configure tracking before running the release helper.`);
  }

  return {
    remote,
    branch: normalizeUpstreamBranch(mergeRef),
  };
}

async function ensureTagDoesNotExist(runGit: GitRunner, tagName: string): Promise<void> {
  const result = await runGitOrThrow(runGit, ['tag', '--list', tagName], 'Could not inspect existing git tags.');

  if (result.stdout.trim().length > 0) {
    throw new Error(`Tag ${tagName} already exists. Choose a different release version.`);
  }
}

export async function runReleaseWorkflow(
  options: ReleaseWorkflowOptions,
  dependencies: ReleaseDependencies,
): Promise<ReleaseResult> {
  const bump = parseReleaseBump(options.bumpArg);
  const packageJsonText = await dependencies.readText(options.packageJsonPath);
  const currentVersion = readPackageVersion(packageJsonText);
  const nextVersion = incrementVersion(currentVersion, bump);
  const tagName = `v${nextVersion}`;
  const packageJsonFile = relative(options.repositoryRoot, options.packageJsonPath);

  await ensureCleanWorktree(dependencies.runGit);

  const localBranch = await resolveLocalBranch(dependencies.runGit);
  const upstreamTarget = await resolveUpstreamTarget(dependencies.runGit, localBranch);

  await ensureTagDoesNotExist(dependencies.runGit, tagName);

  const updatedPackageJson = updatePackageJsonVersion(packageJsonText, nextVersion);
  const commitMessage = `chore: release ${tagName}`;
  const tagMessage = `Release ${tagName}`;

  await dependencies.writeText(options.packageJsonPath, updatedPackageJson);
  await runGitOrThrow(dependencies.runGit, ['add', packageJsonFile], `Could not stage ${packageJsonFile}.`);
  await runGitOrThrow(dependencies.runGit, ['commit', '-m', commitMessage], 'Could not create the release commit.');
  await runGitOrThrow(dependencies.runGit, ['tag', '-a', tagName, '-m', tagMessage], 'Could not create the annotated release tag.');
  await runGitOrThrow(
    dependencies.runGit,
    ['push', '--follow-tags', upstreamTarget.remote, `HEAD:${upstreamTarget.branch}`],
    'Could not push the release commit and tag.',
  );

  dependencies.log(`Released ${tagName} from ${localBranch} to ${upstreamTarget.remote}/${upstreamTarget.branch}.`);

  return {
    bump,
    currentVersion,
    nextVersion,
    tagName,
    localBranch,
    remote: upstreamTarget.remote,
    upstreamBranch: upstreamTarget.branch,
  };
}

export async function main(argv: string[]): Promise<void> {
  await runReleaseWorkflow(
    {
      repositoryRoot,
      packageJsonPath,
      bumpArg: argv[0],
    },
    createReleaseDependencies(repositoryRoot),
  );
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
