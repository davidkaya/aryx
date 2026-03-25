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
      outputDirectoryName: 'Aryx-windows-x64',
      archiveBaseName: 'Aryx-windows-x64',
      sidecarExecutableName: 'Aryx.AgentHost.exe',
      packagedExecutableName: 'Aryx.exe',
    });
  });

  test('maps macOS arm64 to the expected bundle metadata', () => {
    expect(resolveReleaseTarget('darwin', 'arm64')).toEqual({
      platform: 'darwin',
      arch: 'arm64',
      platformLabel: 'macos',
      dotnetRuntime: 'osx-arm64',
      outputDirectoryName: 'Aryx-macos-arm64',
      archiveBaseName: 'Aryx-macos-arm64',
      sidecarExecutableName: 'Aryx.AgentHost',
      appBundleName: 'Aryx.app',
    });
  });

  test('maps Linux x64 to the expected runtime and output names', () => {
    expect(resolveReleaseTarget('linux', 'x64')).toEqual({
      platform: 'linux',
      arch: 'x64',
      platformLabel: 'linux',
      dotnetRuntime: 'linux-x64',
      outputDirectoryName: 'Aryx-linux-x64',
      archiveBaseName: 'Aryx-linux-x64',
      sidecarExecutableName: 'Aryx.AgentHost',
      packagedExecutableName: 'Aryx',
    });
  });

  test('exports the expected product metadata constants', () => {
    expect(productName).toBe('Aryx');
    expect(macBundleIdentifier).toBe('com.davidkaya.aryx');
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
