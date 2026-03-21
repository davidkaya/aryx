import { describe, expect, test } from 'bun:test';

import { resolveSidecarProcess } from '@main/sidecar/sidecarRuntime';

describe('resolveSidecarProcess', () => {
  test('runs the sidecar project with dotnet from the repository root during development', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: false,
        appPath: 'C:\\workspace\\personal\\repositories\\kopaya',
        resourcesPath: 'C:\\workspace\\personal\\repositories\\kopaya\\resources',
        platform: 'win32',
      }),
    ).toEqual({
      command: 'dotnet',
      args: [
        'run',
        '--project',
        'C:\\workspace\\personal\\repositories\\kopaya\\sidecar\\src\\Kopaya.AgentHost\\Kopaya.AgentHost.csproj',
        '--',
        '--stdio',
      ],
      cwd: 'C:\\workspace\\personal\\repositories\\kopaya',
    });
  });

  test('runs the bundled Windows sidecar executable from the resources directory when packaged', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: true,
        appPath: 'C:\\workspace\\personal\\repositories\\kopaya\\release\\win-unpacked\\resources\\app',
        resourcesPath: 'C:\\workspace\\personal\\repositories\\kopaya\\release\\win-unpacked\\resources',
        platform: 'win32',
      }),
    ).toEqual({
      command: 'C:\\workspace\\personal\\repositories\\kopaya\\release\\win-unpacked\\resources\\sidecar\\Kopaya.AgentHost.exe',
      args: ['--stdio'],
      cwd: 'C:\\workspace\\personal\\repositories\\kopaya\\release\\win-unpacked\\resources\\sidecar',
    });
  });

  test('omits the .exe suffix for bundled non-Windows sidecar binaries', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: true,
        appPath: '/Applications/Kopaya.app/Contents/Resources/app',
        resourcesPath: '/Applications/Kopaya.app/Contents/Resources',
        platform: 'darwin',
      }),
    ).toEqual({
      command: '/Applications/Kopaya.app/Contents/Resources/sidecar/Kopaya.AgentHost',
      args: ['--stdio'],
      cwd: '/Applications/Kopaya.app/Contents/Resources/sidecar',
    });
  });
});
