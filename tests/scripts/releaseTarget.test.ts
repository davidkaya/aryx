import { describe, expect, test } from 'bun:test';

import {
  macBundleIdentifier,
  productName,
  resolveReleaseTarget,
} from '../../scripts/releaseTarget';

describe('resolveReleaseTarget', () => {
  test('maps Windows x64 to the expected runtime and output names', () => {
    expect(resolveReleaseTarget('win32', 'x64')).toEqual({
      platform: 'win32',
      arch: 'x64',
      platformLabel: 'windows',
      dotnetRuntime: 'win-x64',
      outputDirectoryName: 'Eryx-windows-x64',
      archiveBaseName: 'Eryx-windows-x64',
      sidecarExecutableName: 'Eryx.AgentHost.exe',
      packagedExecutableName: 'Eryx.exe',
    });
  });

  test('maps macOS arm64 to the expected bundle metadata', () => {
    expect(resolveReleaseTarget('darwin', 'arm64')).toEqual({
      platform: 'darwin',
      arch: 'arm64',
      platformLabel: 'macos',
      dotnetRuntime: 'osx-arm64',
      outputDirectoryName: 'Eryx-macos-arm64',
      archiveBaseName: 'Eryx-macos-arm64',
      sidecarExecutableName: 'Eryx.AgentHost',
      appBundleName: 'Eryx.app',
    });
  });

  test('maps Linux x64 to the expected runtime and output names', () => {
    expect(resolveReleaseTarget('linux', 'x64')).toEqual({
      platform: 'linux',
      arch: 'x64',
      platformLabel: 'linux',
      dotnetRuntime: 'linux-x64',
      outputDirectoryName: 'Eryx-linux-x64',
      archiveBaseName: 'Eryx-linux-x64',
      sidecarExecutableName: 'Eryx.AgentHost',
      packagedExecutableName: 'Eryx',
    });
  });

  test('exports the expected product metadata constants', () => {
    expect(productName).toBe('Eryx');
    expect(macBundleIdentifier).toBe('com.davidkaya.eryx');
  });

  test('rejects unsupported platforms', () => {
    expect(() => resolveReleaseTarget('freebsd', 'x64')).toThrow(
      'Unsupported release platform: freebsd',
    );
  });

  test('rejects unsupported architectures', () => {
    expect(() => resolveReleaseTarget('linux', 'ia32')).toThrow(
      'Unsupported architecture for linux: ia32',
    );
  });
});
