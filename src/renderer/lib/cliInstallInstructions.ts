import type { DetectedPlatform } from './platform';

export interface InstallMethod {
  label: string;
  command: string;
  recommended?: boolean;
}

export interface PlatformInstallInfo {
  platform: DetectedPlatform;
  displayName: string;
  methods: InstallMethod[];
}

export const installInstructions: PlatformInstallInfo[] = [
  {
    platform: 'macos',
    displayName: 'macOS',
    methods: [
      { label: 'Homebrew', command: 'brew install copilot-cli', recommended: true },
      { label: 'Install script', command: 'curl -fsSL https://gh.io/copilot-install | bash' },
      { label: 'npm', command: 'npm install -g @github/copilot' },
    ],
  },
  {
    platform: 'windows',
    displayName: 'Windows',
    methods: [
      { label: 'WinGet', command: 'winget install GitHub.Copilot', recommended: true },
      { label: 'npm', command: 'npm install -g @github/copilot' },
    ],
  },
  {
    platform: 'linux',
    displayName: 'Linux',
    methods: [
      { label: 'Install script', command: 'curl -fsSL https://gh.io/copilot-install | bash', recommended: true },
      { label: 'Homebrew', command: 'brew install copilot-cli' },
      { label: 'npm', command: 'npm install -g @github/copilot' },
    ],
  },
];

export const authCommand = 'copilot auth login';

export function getInstallInfoForPlatform(platform: DetectedPlatform): PlatformInstallInfo {
  return installInstructions.find((i) => i.platform === platform)!;
}
