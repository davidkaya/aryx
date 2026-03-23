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
  const iconFileName = context.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';

  return pathModule.join(context.appPath, 'assets', 'icons', iconFileName);
}
