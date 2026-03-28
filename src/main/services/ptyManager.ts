import { EventEmitter } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, join } from 'node:path';

import type { TerminalExitInfo, TerminalSnapshot } from '@shared/domain/terminal';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_TERMINAL_NAME = 'xterm-256color';
const DEFAULT_UNIX_SHELL = '/bin/bash';
const DEFAULT_WINDOWS_FALLBACK_SHELL = 'cmd.exe';

type Disposable = {
  dispose(): void;
};

interface ManagedPty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: TerminalExitInfo) => void): Disposable;
}

type PtySpawnOptions = {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
};

type PtySpawn = (
  file: string,
  args: string[],
  options: PtySpawnOptions,
) => ManagedPty | Promise<ManagedPty>;

type CommandExists = (
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) => Promise<boolean>;

type ActiveTerminal = {
  pty: ManagedPty;
  snapshot: TerminalSnapshot;
  dataSubscription: Disposable;
  exitSubscription: Disposable;
};

type PtyManagerEvents = {
  data: [string];
  exit: [TerminalExitInfo];
};

export interface PtyManagerOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawnPty?: PtySpawn;
  commandExists?: CommandExists;
}

export class PtyManager extends EventEmitter<PtyManagerEvents> {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly spawnPty: PtySpawn;
  private readonly commandExists: CommandExists;
  private activeTerminal?: ActiveTerminal;

  constructor(options: PtyManagerOptions = {}) {
    super();
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.spawnPty = options.spawnPty ?? defaultSpawnPty;
    this.commandExists = options.commandExists ?? commandExistsOnPath;
  }

  get isRunning(): boolean {
    return this.activeTerminal !== undefined;
  }

  getSnapshot(): TerminalSnapshot | undefined {
    return this.activeTerminal ? { ...this.activeTerminal.snapshot } : undefined;
  }

  async create(cwd: string, cols = DEFAULT_COLS, rows = DEFAULT_ROWS): Promise<TerminalSnapshot> {
    if (this.activeTerminal) {
      return { ...this.activeTerminal.snapshot };
    }

    return this.spawnTerminal(cwd, cols, rows);
  }

  async restart(
    cwd: string,
    cols = this.activeTerminal?.snapshot.cols ?? DEFAULT_COLS,
    rows = this.activeTerminal?.snapshot.rows ?? DEFAULT_ROWS,
  ): Promise<TerminalSnapshot> {
    this.disposeActiveTerminal();
    return this.spawnTerminal(cwd, cols, rows);
  }

  write(data: string): void {
    if (!data) {
      return;
    }

    if (!this.activeTerminal) {
      console.warn('[aryx terminal] Ignoring terminal write because no terminal is running.');
      return;
    }

    this.activeTerminal.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.activeTerminal) {
      console.warn('[aryx terminal] Ignoring terminal resize because no terminal is running.');
      return;
    }

    const nextCols = normalizeDimension(cols, DEFAULT_COLS);
    const nextRows = normalizeDimension(rows, DEFAULT_ROWS);
    this.activeTerminal.pty.resize(nextCols, nextRows);
    this.activeTerminal.snapshot.cols = nextCols;
    this.activeTerminal.snapshot.rows = nextRows;
  }

  kill(): void {
    this.activeTerminal?.pty.kill();
  }

  dispose(): void {
    this.disposeActiveTerminal();
  }

  private async spawnTerminal(cwd: string, cols: number, rows: number): Promise<TerminalSnapshot> {
    await assertDirectory(cwd);

    const nextCols = normalizeDimension(cols, DEFAULT_COLS);
    const nextRows = normalizeDimension(rows, DEFAULT_ROWS);
    const shell = await resolveShellCommand(this.platform, this.env, this.commandExists);
    const pty = await this.spawnPty(shell.command, shell.args, {
      name: DEFAULT_TERMINAL_NAME,
      cols: nextCols,
      rows: nextRows,
      cwd,
      env: sanitizeEnvironment(this.env),
    });

    const snapshot: TerminalSnapshot = {
      cwd,
      shell: shell.label,
      pid: pty.pid,
      cols: nextCols,
      rows: nextRows,
    };

    const active: ActiveTerminal = {
      pty,
      snapshot,
      dataSubscription: { dispose() {} },
      exitSubscription: { dispose() {} },
    };

    active.dataSubscription = pty.onData((data) => {
      if (this.activeTerminal?.pty !== pty) {
        return;
      }

      this.emit('data', data);
    });
    active.exitSubscription = pty.onExit((event) => {
      if (this.activeTerminal?.pty !== pty) {
        return;
      }

      this.activeTerminal = undefined;
      active.dataSubscription.dispose();
      active.exitSubscription.dispose();
      this.emit('exit', event);
    });

    this.activeTerminal = active;
    return { ...snapshot };
  }

  private disposeActiveTerminal(): void {
    const active = this.activeTerminal;
    if (!active) {
      return;
    }

    this.activeTerminal = undefined;
    active.dataSubscription.dispose();
    active.exitSubscription.dispose();

    try {
      active.pty.kill();
    } catch (error) {
      console.warn('[aryx terminal] Failed to stop terminal during cleanup.', error);
    }
  }
}

async function defaultSpawnPty(
  file: string,
  args: string[],
  options: PtySpawnOptions,
): Promise<ManagedPty> {
  const { spawn } = await import('node-pty');
  return spawn(file, args, options) as ManagedPty;
}

async function resolveShellCommand(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  commandExists: CommandExists,
): Promise<{ command: string; args: string[]; label: string }> {
  if (platform === 'win32') {
    const windowsPowerShellPath = resolveWindowsPowerShellPath(env);
    const candidates = [
      { command: 'pwsh.exe', args: ['-NoLogo'], label: 'PowerShell' },
      { command: windowsPowerShellPath, args: ['-NoLogo'], label: 'PowerShell' },
      ...(env.COMSPEC || env.ComSpec
        ? [{
          command: env.COMSPEC ?? env.ComSpec ?? DEFAULT_WINDOWS_FALLBACK_SHELL,
          args: [],
          label: resolveShellLabel(env.COMSPEC ?? env.ComSpec ?? DEFAULT_WINDOWS_FALLBACK_SHELL),
        }]
        : []),
      { command: DEFAULT_WINDOWS_FALLBACK_SHELL, args: [], label: 'Command Prompt' },
    ] satisfies Array<{ command: string; args: string[]; label: string }>;

    for (const candidate of candidates) {
      if (await commandExists(candidate.command, env, platform)) {
        return candidate;
      }
    }

    return candidates[candidates.length - 1]!;
  }

  const configuredShell = env.SHELL?.trim();
  if (configuredShell && await commandExists(configuredShell, env, platform)) {
    return { command: configuredShell, args: [], label: resolveShellLabel(configuredShell) };
  }

  return { command: DEFAULT_UNIX_SHELL, args: [], label: resolveShellLabel(DEFAULT_UNIX_SHELL) };
}

async function commandExistsOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<boolean> {
  if (isAbsolute(command)) {
    return fileExists(command, platform);
  }

  const searchPath = env.PATH ?? env.Path ?? '';
  const pathEntries = searchPath.split(delimiter).filter((entry) => entry.length > 0);
  const commandNames = platform === 'win32'
    ? expandWindowsCommandCandidates(command)
    : [command];

  for (const entry of pathEntries) {
    for (const candidate of commandNames) {
      if (await fileExists(join(entry, candidate), platform)) {
        return true;
      }
    }
  }

  return false;
}

async function fileExists(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(path, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandWindowsCommandCandidates(command: string): string[] {
  if (command.includes('.')) {
    return [command];
  }

  return [
    `${command}.exe`,
    `${command}.cmd`,
    `${command}.bat`,
    command,
  ];
}

function resolveWindowsPowerShellPath(env: NodeJS.ProcessEnv): string {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function resolveShellLabel(command: string): string {
  const baseName = basename(command).replace(/\.(exe|cmd|bat)$/i, '');
  if (baseName === 'pwsh' || baseName === 'powershell') {
    return 'PowerShell';
  }

  if (baseName === 'cmd') {
    return 'Command Prompt';
  }

  return baseName;
}

function sanitizeEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...env,
      TERM: DEFAULT_TERMINAL_NAME,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function normalizeDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.round(value);
  return normalized >= 1 ? normalized : fallback;
}

async function assertDirectory(path: string): Promise<void> {
  try {
    const entry = await stat(path);
    if (!entry.isDirectory()) {
      throw new Error(`Terminal working directory "${path}" is not a directory.`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Terminal working directory "${path}" is unavailable.`, { cause: error });
    }

    throw error;
  }
}
