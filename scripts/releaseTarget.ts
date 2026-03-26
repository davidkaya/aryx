export const productName = 'Aryx';
export const macBundleIdentifier = 'com.davidkaya.aryx';

type SupportedPlatform = 'win32' | 'darwin' | 'linux';
type SupportedArch = 'x64' | 'arm64';

export interface ReleaseTarget {
  readonly platform: SupportedPlatform;
  readonly arch: SupportedArch;
  readonly platformLabel: 'windows' | 'macos' | 'linux';
  readonly dotnetRuntime: `${string}-${SupportedArch}`;
  readonly outputDirectoryName: string;
  readonly archiveBaseName: string;
  readonly installerAssetName: string;
  readonly sidecarExecutableName: string;
  readonly packagedExecutableName?: string;
  readonly appBundleName?: string;
}

function resolveSupportedArch(
  platform: SupportedPlatform,
  arch: NodeJS.Architecture,
): SupportedArch {
  if (arch === 'x64' || arch === 'arm64') {
    return arch;
  }

  throw new Error(`Unsupported architecture for ${platform}: ${arch}`);
}

export function resolveReleaseTarget(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): ReleaseTarget {
  switch (platform) {
    case 'win32': {
      const supportedArch = resolveSupportedArch(platform, arch);
      const archiveBaseName = `${productName}-windows-${supportedArch}`;

      return {
        platform,
        arch: supportedArch,
        platformLabel: 'windows',
        dotnetRuntime: `win-${supportedArch}`,
        outputDirectoryName: archiveBaseName,
        archiveBaseName,
        installerAssetName: `${archiveBaseName}-setup.exe`,
        sidecarExecutableName: 'Aryx.AgentHost.exe',
        packagedExecutableName: `${productName}.exe`,
      };
    }
    case 'darwin': {
      const supportedArch = resolveSupportedArch(platform, arch);
      const archiveBaseName = `${productName}-macos-${supportedArch}`;

      return {
        platform,
        arch: supportedArch,
        platformLabel: 'macos',
        dotnetRuntime: `osx-${supportedArch}`,
        outputDirectoryName: archiveBaseName,
        archiveBaseName,
        installerAssetName: `${archiveBaseName}.dmg`,
        sidecarExecutableName: 'Aryx.AgentHost',
        appBundleName: `${productName}.app`,
      };
    }
    case 'linux': {
      const supportedArch = resolveSupportedArch(platform, arch);
      const archiveBaseName = `${productName}-linux-${supportedArch}`;

      return {
        platform,
        arch: supportedArch,
        platformLabel: 'linux',
        dotnetRuntime: `linux-${supportedArch}`,
        outputDirectoryName: archiveBaseName,
        archiveBaseName,
        installerAssetName: `aryx-linux-${supportedArch}.deb`,
        sidecarExecutableName: 'Aryx.AgentHost',
        packagedExecutableName: productName,
      };
    }
    default:
      throw new Error(`Unsupported release platform: ${platform}`);
  }
}
