import { describe, expect, mock, test } from 'bun:test';

import type { SidecarCapabilities } from '@shared/contracts/sidecar';

mock.module('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
    getPath: () => 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures',
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  shell: {
    openPath: async () => '',
  },
}));

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { AryxAppService } = await import('@main/AryxAppService');

const SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE =
  'The .NET sidecar was stopped before the command completed.';

const CAPABILITIES_FIXTURE: SidecarCapabilities = {
  runtime: 'dotnet-maf',
  modes: {
    single: { available: true },
    sequential: { available: true },
    concurrent: { available: true },
    handoff: { available: true },
    magentic: { available: false, reason: 'Not yet supported.' },
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

function setSidecar(
  service: InstanceType<typeof AryxAppService>,
  describeCapabilities: () => Promise<SidecarCapabilities>,
): void {
  (
    service as unknown as {
      sidecar: {
        describeCapabilities: () => Promise<SidecarCapabilities>;
        dispose: () => Promise<void>;
      };
    }
  ).sidecar = {
    describeCapabilities,
    dispose: async () => undefined,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('AryxAppService sidecar capabilities', () => {
  test('retries describe-capabilities after an intentional sidecar stop', async () => {
    const service = new AryxAppService();
    let attempts = 0;

    setSidecar(service, async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error(SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE);
      }

      return CAPABILITIES_FIXTURE;
    });

    await expect(service.describeSidecarCapabilities()).resolves.toEqual(CAPABILITIES_FIXTURE);
    expect(attempts).toBe(2);
  });

  test('coalesces concurrent capability requests while the cache is empty', async () => {
    const service = new AryxAppService();
    const deferred = createDeferred<SidecarCapabilities>();
    let calls = 0;

    setSidecar(service, async () => {
      calls += 1;
      return deferred.promise;
    });

    const first = service.describeSidecarCapabilities();
    const second = service.describeSidecarCapabilities();

    expect(calls).toBe(1);

    deferred.resolve(CAPABILITIES_FIXTURE);

    await expect(first).resolves.toEqual(CAPABILITIES_FIXTURE);
    await expect(second).resolves.toEqual(CAPABILITIES_FIXTURE);
    await expect(service.describeSidecarCapabilities()).resolves.toEqual(CAPABILITIES_FIXTURE);

    expect(calls).toBe(1);
  });
});
