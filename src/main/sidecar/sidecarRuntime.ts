import { posix, win32 } from 'node:path';

export interface SidecarRuntimeContext {
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly platform: NodeJS.Platform;
}

export interface ResolvedSidecarProcess {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
}

function getPathModule(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

function getBundledSidecarExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'Eryx.AgentHost.exe' : 'Eryx.AgentHost';
}

export function resolveSidecarProcess(context: SidecarRuntimeContext): ResolvedSidecarProcess {
  const pathModule = getPathModule(context.platform);

  if (context.isPackaged) {
    const sidecarDirectory = pathModule.join(context.resourcesPath, 'sidecar');

    return {
      command: pathModule.join(sidecarDirectory, getBundledSidecarExecutableName(context.platform)),
      args: ['--stdio'],
      cwd: sidecarDirectory,
    };
  }

  return {
    command: 'dotnet',
    args: [
      'run',
      '--project',
      pathModule.join(context.appPath, 'sidecar', 'src', 'Eryx.AgentHost', 'Eryx.AgentHost.csproj'),
      '--',
      '--stdio',
    ],
    cwd: context.appPath,
  };
}
