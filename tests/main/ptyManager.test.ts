import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TerminalExitInfo, TerminalSnapshot } from '@shared/domain/terminal';
import { PtyManager } from '@main/services/ptyManager';

class FakePty {
  readonly pid: number;
  readonly writes: string[] = [];
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  killCalls = 0;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: TerminalExitInfo) => void>();

  constructor(pid: number) {
    this.pid = pid;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
  }

  kill(): void {
    this.killCalls += 1;
    this.emitExit({ exitCode: 0 });
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener);
    return {
      dispose: () => {
        this.dataListeners.delete(listener);
      },
    };
  }

  onExit(listener: (event: TerminalExitInfo) => void): { dispose(): void } {
    this.exitListeners.add(listener);
    return {
      dispose: () => {
        this.exitListeners.delete(listener);
      },
    };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event: TerminalExitInfo): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'aryx-pty-'));
  tempDirectories.push(path);
  return path;
}

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const path = tempDirectories.pop();
    if (path) {
      await rm(path, { force: true, recursive: true });
    }
  }
});

describe('PtyManager', () => {
  test('prefers PowerShell on Windows when available', async () => {
    const cwd = await createTempDirectory();
    const spawnCalls: Array<{ file: string; args: string[]; options: { cwd: string } }> = [];
    const pty = new FakePty(101);
    const manager = new PtyManager({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      commandExists: async (command) => command === 'pwsh.exe',
      spawnPty: async (file, args, options) => {
        spawnCalls.push({ file, args, options });
        return pty;
      },
    });

    const snapshot = await manager.create(cwd);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.file).toBe('pwsh.exe');
    expect(spawnCalls[0]?.args).toEqual(['-NoLogo']);
    expect(spawnCalls[0]?.options.cwd).toBe(cwd);
    expect(snapshot).toEqual({
      cwd,
      shell: 'PowerShell',
      pid: 101,
      cols: 80,
      rows: 24,
    } satisfies TerminalSnapshot);
  });

  test('forwards data, writes input, and tracks resized dimensions', async () => {
    const cwd = await createTempDirectory();
    const pty = new FakePty(202);
    const chunks: string[] = [];
    const manager = new PtyManager({
      platform: 'linux',
      env: { SHELL: '/bin/zsh', PATH: '/bin' },
      commandExists: async () => true,
      spawnPty: async () => pty,
    });

    manager.on('data', (data) => {
      chunks.push(data);
    });

    await manager.create(cwd);
    pty.emitData('$ ready');
    manager.write('npm test\r');
    manager.resize(120.2, 41.6);

    expect(chunks).toEqual(['$ ready']);
    expect(pty.writes).toEqual(['npm test\r']);
    expect(pty.resizeCalls).toEqual([{ cols: 120, rows: 42 }]);
    expect(manager.getSnapshot()).toEqual({
      cwd,
      shell: 'zsh',
      pid: 202,
      cols: 120,
      rows: 42,
    } satisfies TerminalSnapshot);
  });

  test('kills the active terminal, emits exit, and clears the snapshot', async () => {
    const cwd = await createTempDirectory();
    const exits: TerminalExitInfo[] = [];
    const pty = new FakePty(303);
    const manager = new PtyManager({
      platform: 'linux',
      env: { SHELL: '/bin/bash', PATH: '/bin' },
      commandExists: async () => true,
      spawnPty: async () => pty,
    });

    manager.on('exit', (event) => {
      exits.push(event);
    });

    await manager.create(cwd);
    manager.kill();

    expect(exits).toEqual([{ exitCode: 0 }]);
    expect(manager.getSnapshot()).toBeUndefined();
  });

  test('restarts without forwarding the replaced terminal exit event', async () => {
    const cwd = await createTempDirectory();
    const exits: TerminalExitInfo[] = [];
    const ptys = [new FakePty(404), new FakePty(405)];
    let spawnIndex = 0;
    const manager = new PtyManager({
      platform: 'linux',
      env: { SHELL: '/bin/bash', PATH: '/bin' },
      commandExists: async () => true,
      spawnPty: async () => ptys[spawnIndex++]!,
    });

    manager.on('exit', (event) => {
      exits.push(event);
    });

    await manager.create(cwd);
    manager.resize(132, 36);
    const restarted = await manager.restart(cwd);

    expect(ptys[0].killCalls).toBe(1);
    expect(exits).toEqual([]);
    expect(restarted).toEqual({
      cwd,
      shell: 'bash',
      pid: 405,
      cols: 132,
      rows: 36,
    } satisfies TerminalSnapshot);
  });

  test('throws when the working directory does not exist', async () => {
    const manager = new PtyManager({
      platform: 'linux',
      env: { SHELL: '/bin/bash', PATH: '/bin' },
      commandExists: async () => true,
      spawnPty: async () => new FakePty(500),
    });

    await expect(manager.create('C:\\workspace\\personal\\repositories\\aryx\\does-not-exist'))
      .rejects
      .toThrow('Terminal working directory');
  });
});
