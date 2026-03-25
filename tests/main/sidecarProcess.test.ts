import { EventEmitter } from 'node:events';

import { describe, expect, mock, test } from 'bun:test';

import type { SidecarCapabilities } from '@shared/contracts/sidecar';

class FakeReadableStream extends EventEmitter {
  setEncoding(_encoding: BufferEncoding): void {}
}

class FakeWritableStream {
  readonly writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new FakeReadableStream();
  readonly stderr = new FakeReadableStream();
  readonly stdin = new FakeWritableStream();
  exitCode: number | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitStdout(line: string): void {
    this.stdout.emit('data', line);
  }

  completeExit(code = 0): void {
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

const spawnedProcesses: FakeChildProcess[] = [];

mock.module('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
  },
}));

mock.module('node:child_process', () => ({
  spawn: () => {
    const child = new FakeChildProcess();
    spawnedProcesses.push(child);
    return child;
  },
}));

const { SidecarClient } = await import('@main/sidecar/sidecarProcess');

const CAPABILITIES_FIXTURE: SidecarCapabilities = {
  runtime: 'dotnet-maf',
  modes: {
    single: { available: true },
    sequential: { available: true },
    concurrent: { available: true },
    handoff: { available: true },
    magentic: { available: true },
    'group-chat': { available: true },
  },
  models: [],
  runtimeTools: [],
  connection: {
    status: 'ready',
    summary: 'Connected',
    checkedAt: '2026-03-25T00:00:00.000Z',
  },
};

function getRequestId(process: FakeChildProcess): string {
  const rawRequest = process.stdin.writes.at(-1);
  if (!rawRequest) {
    throw new Error('Expected the fake sidecar to receive a request.');
  }

  return (JSON.parse(rawRequest.trim()) as { requestId: string }).requestId;
}

describe('SidecarClient', () => {
  test('waits for the disposed sidecar to fully close before spawning a replacement process', async () => {
    spawnedProcesses.length = 0;
    const client = new SidecarClient();

    const firstCapabilities = client.describeCapabilities();
    await Promise.resolve();
    expect(spawnedProcesses).toHaveLength(1);
    spawnedProcesses[0]!.emitStdout(
      `${JSON.stringify({
        type: 'capabilities',
        requestId: getRequestId(spawnedProcesses[0]!),
        capabilities: CAPABILITIES_FIXTURE,
      })}\n`,
    );
    await expect(firstCapabilities).resolves.toEqual(CAPABILITIES_FIXTURE);

    let disposeCompleted = false;
    const disposePromise = client.dispose().then(() => {
      disposeCompleted = true;
    });

    const replacementCapabilities = client.describeCapabilities();

    await Promise.resolve();

    expect(disposeCompleted).toBe(false);
    expect(spawnedProcesses).toHaveLength(1);

    spawnedProcesses[0]!.completeExit();
    await disposePromise;

    expect(disposeCompleted).toBe(true);
    expect(spawnedProcesses).toHaveLength(2);

    spawnedProcesses[1]!.emitStdout(
      `${JSON.stringify({
        type: 'capabilities',
        requestId: getRequestId(spawnedProcesses[1]!),
        capabilities: CAPABILITIES_FIXTURE,
      })}\n`,
    );
    await expect(replacementCapabilities).resolves.toEqual(CAPABILITIES_FIXTURE);

    const finalDispose = client.dispose();
    spawnedProcesses[1]!.completeExit();
    await finalDispose;
  });
});
