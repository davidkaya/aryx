export type DetectedPlatform = 'macos' | 'windows' | 'linux';

export const isMac = navigator.platform.startsWith('Mac');
export const isWindows = navigator.platform.startsWith('Win');
export const isLinux = !isMac && !isWindows;

export const detectedPlatform: DetectedPlatform =
  isMac ? 'macos' : isWindows ? 'windows' : 'linux';
