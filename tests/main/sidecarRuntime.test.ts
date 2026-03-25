import { describe, expect, test } from 'bun:test';

import { resolveSidecarProcess } from '@main/sidecar/sidecarRuntime';

describe('resolveSidecarProcess', () => {
  test('runs the sidecar project with dotnet from the repository root during development', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: false,
        appPath: 'C:\\workspace\\personal\\repositories\\eryx',
        resourcesPath: 'C:\\workspace\\personal\\repositories\\eryx\\resources',
        platform: 'win32',
      }),
    ).toEqual({
      command: 'dotnet',
      args: [
        'run',
        '--project',
        'C:\\workspace\\personal\\repositories\\eryx\\sidecar\\src\\Eryx.AgentHost\\Eryx.AgentHost.csproj',
        '--',
        '--stdio',
      ],
      cwd: 'C:\\workspace\\personal\\repositories\\eryx',
    });
  });

  test('runs the bundled Windows sidecar executable from the resources directory when packaged', () => {
    expect(
      resolveSidecarProcess({
        isPackaged: true,
        appPath: 'C:\\workspace\\personal\\repositories\\eryx\\release\\win-unpacked\\resources\\app',
        resourcesPath: 'C:\\workspace\\personal\\repositories\\eryx\\release\\win-unpacked\\resources',
        platform: 'win32',
      }),
    ).toEqual({
      command: 'C:\\workspace\\personal\\repositories\\eryx\\release\\win-unpacked\\resources\\sidecar\\Eryx.AgentHost.exe',
      args: ['--stdio'],
      cwd: 'C:\\workspace\\personal\\repositories\\eryx\\release\\win-unpacked\\resources\\sidecar',
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
      command: '/Applications/Aryx.app/Contents/Resources/sidecar/Eryx.AgentHost',
      args: ['--stdio'],
      cwd: '/Applications/Aryx.app/Contents/Resources/sidecar',
    });
  });
});
