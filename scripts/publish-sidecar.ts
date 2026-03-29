import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      if (signal) {
        rejectPromise(new Error(`${command} exited because of signal ${signal}.`));
        return;
      }

      rejectPromise(new Error(`${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

type SupportedPlatform = 'win32' | 'darwin' | 'linux';
type SupportedArch = 'x64' | 'arm64';

function resolveDotnetRuntime(platform: NodeJS.Platform, arch: NodeJS.Architecture): `${string}-${SupportedArch}` {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported architecture for sidecar publish: ${arch}`);
  }

  switch (platform) {
    case 'win32':
      return `win-${arch}`;
    case 'darwin':
      return `osx-${arch}`;
    case 'linux':
      return `linux-${arch}`;
    default:
      throw new Error(`Unsupported platform for sidecar publish: ${platform}`);
  }
}

function resolvePlatformLabel(platform: SupportedPlatform): 'windows' | 'macos' | 'linux' {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
  }
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const dotnetRuntime = resolveDotnetRuntime(process.platform, process.arch);
const sidecarProjectPath = join(
  repositoryRoot,
  'sidecar',
  'src',
  'Aryx.AgentHost',
  'Aryx.AgentHost.csproj',
);
const outputDirectory = join(repositoryRoot, 'dist-sidecar');

await rm(outputDirectory, { recursive: true, force: true });

await runCommand(
  'dotnet',
  [
    'publish',
    sidecarProjectPath,
    '-c',
    'Release',
    '-r',
    dotnetRuntime,
    '--self-contained',
    'true',
    '-p:DebugType=None',
    '-p:DebugSymbols=false',
    '-p:PublishTrimmed=true',
    '-p:TrimMode=partial',
    '-p:PublishSingleFile=true',
    '-o',
    outputDirectory,
  ],
  repositoryRoot,
);

console.log(`Published sidecar for ${resolvePlatformLabel(process.platform as SupportedPlatform)} (${dotnetRuntime}) to ${outputDirectory}`);
