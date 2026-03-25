import { describe, expect, test } from 'bun:test';

import { resolveWindowIconPath } from '@main/windows/appIcon';

describe('resolveWindowIconPath', () => {
  test('uses the Windows ico asset from the platform-specific icon directory', () => {
    expect(
      resolveWindowIconPath({
        appPath: 'C:\\workspace\\personal\\repositories\\aryx',
        platform: 'win32',
      }),
    ).toBe('C:\\workspace\\personal\\repositories\\aryx\\assets\\icons\\windows\\icon.ico');
  });

  test('uses the macOS icns asset on Darwin', () => {
    expect(
      resolveWindowIconPath({
        appPath: '/Applications/Aryx.app/Contents/Resources/app',
        platform: 'darwin',
      }),
    ).toBe('/Applications/Aryx.app/Contents/Resources/app/assets/icons/macos/icon.icns');
  });

  test('uses the Linux 512px PNG asset on Linux', () => {
    expect(
      resolveWindowIconPath({
        appPath: '/opt/aryx/resources/app',
        platform: 'linux',
      }),
    ).toBe('/opt/aryx/resources/app/assets/icons/linux/icons/512x512.png');
  });
});
