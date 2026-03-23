import { posix, win32 } from 'node:path';

export interface WindowIconPathContext {
  readonly appPath: string;
  readonly platform: NodeJS.Platform;
}

function getPathModule(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

export function resolveWindowIconPath(context: WindowIconPathContext): string {
  const pathModule = getPathModule(context.platform);
  switch (context.platform) {
    case 'win32':
      return pathModule.join(context.appPath, 'assets', 'icons', 'windows', 'icon.ico');
    case 'darwin':
      return pathModule.join(context.appPath, 'assets', 'icons', 'macos', 'icon.icns');
    case 'linux':
      return pathModule.join(context.appPath, 'assets', 'icons', 'linux', 'icons', '512x512.png');
    default:
      return pathModule.join(context.appPath, 'assets', 'icons', 'icon.png');
  }
}
