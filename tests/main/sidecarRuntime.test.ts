import { describe, expect, test } from 'bun:test';

import { resolveSidecarProcess } from '@main/sidecar/sidecarRuntime';

describe('resolveSidecarProcess', () => {
  test('runs the sidecar project with dotnet from the repository root during development', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: false,
        appPath: 'C:\\workspace\\personal\\repositories\\aryx',
        resourcesPath: 'C:\\workspace\\personal\\repositories\\aryx\\resources',
        platform: 'win32',
      }),
    ).toEqual({
      command: 'dotnet',
      args: [
        'run',
        '--project',
        'C:\\workspace\\personal\\repositories\\aryx\\sidecar\\src\\Aryx.AgentHost\\Aryx.AgentHost.csproj',
        '--',
        '--stdio',
      ],
      cwd: 'C:\\workspace\\personal\\repositories\\aryx',
    });
  });

  test('runs the bundled Windows sidecar executable from the resources directory when packaged', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: true,
        appPath: 'C:\\workspace\\personal\\repositories\\aryx\\release\\win-unpacked\\resources\\app',
        resourcesPath: 'C:\\workspace\\personal\\repositories\\aryx\\release\\win-unpacked\\resources',
        platform: 'win32',
      }),
    ).toEqual({
      command: 'C:\\workspace\\personal\\repositories\\aryx\\release\\win-unpacked\\resources\\sidecar\\Aryx.AgentHost.exe',
      args: ['--stdio'],
      cwd: 'C:\\workspace\\personal\\repositories\\aryx\\release\\win-unpacked\\resources\\sidecar',
    });
  });

  test('omits the .exe suffix for bundled non-Windows sidecar binaries', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: true,
        appPath: '/Applications/Aryx.app/Contents/Resources/app',
        resourcesPath: '/Applications/Aryx.app/Contents/Resources',
        platform: 'darwin',
      }),
    ).toEqual({
      command: '/Applications/Aryx.app/Contents/Resources/sidecar/Aryx.AgentHost',
      args: ['--stdio'],
      cwd: '/Applications/Aryx.app/Contents/Resources/sidecar',
    });
  });
});
