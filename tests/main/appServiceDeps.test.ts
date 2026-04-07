import { describe, expect, mock, test } from 'bun:test';

import type { SidecarCapabilities } from '@shared/contracts/sidecar';

mock.module('electron', () => {
  const electronMock = {
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
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { AryxAppService } = await import('@main/AryxAppService');

describe('AryxAppService dependency injection', () => {
  test('uses injected sidecar dependencies for capability lookups', async () => {
    const capabilities: SidecarCapabilities = {
      runtime: 'dotnet-maf',
      modes: {
        single: { available: true },
        sequential: { available: true },
        concurrent: { available: true },
        handoff: { available: true },
        'group-chat': { available: true },
        magentic: { available: true },
      },
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
        },
      ],
      runtimeTools: [],
      connection: {
        status: 'ready',
        summary: 'Ready',
        checkedAt: '2026-04-07T00:00:00.000Z',
      },
    };

    const service = new AryxAppService({
      sidecar: {
        describeCapabilities: async () => capabilities,
        dispose: async () => undefined,
      } as never,
    });

    await expect(service.describeSidecarCapabilities()).resolves.toEqual(capabilities);
  });
});
