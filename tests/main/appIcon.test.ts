import { describe, expect, test } from 'bun:test';

import { resolveWindowIconPath } from '@main/windows/appIcon';

describe('resolveWindowIconPath', () => {
  test('uses the Windows ico asset from the packaged app assets directory', () => {
    expect(
      resolveWindowIconPath({
        appPath: 'C:\\workspace\\personal\\repositories\\kopaya',
        platform: 'win32',
      }),
    ).toBe('C:\\workspace\\personal\\repositories\\kopaya\\assets\\icons\\app-icon.ico');
  });

  test('uses the PNG asset on non-Windows platforms', () => {
    expect(
      resolveWindowIconPath({
        appPath: '/Applications/Kopaya.app/Contents/Resources/app',
        platform: 'darwin',
      }),
    ).toBe('/Applications/Kopaya.app/Contents/Resources/app/assets/icons/app-icon.png');
  });
});
