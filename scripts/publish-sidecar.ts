import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveReleaseTarget } from './releaseTarget';

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

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const releaseTarget = resolveReleaseTarget(process.platform, process.arch);
const sidecarProjectPath = join(
  repositoryRoot,
  'sidecar',
  'src',
  'Aryx.AgentHost',
  'Aryx.AgentHost.csproj',
);
const outputDirectory = join(repositoryRoot, 'dist-sidecar', releaseTarget.dotnetRuntime);

await rm(outputDirectory, { recursive: true, force: true });

await runCommand(
  'dotnet',
  [
    'publish',
    sidecarProjectPath,
    '-c',
    'Release',
    '-r',
    releaseTarget.dotnetRuntime,
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

console.log(`Published sidecar for ${releaseTarget.platformLabel} (${releaseTarget.dotnetRuntime}) to ${outputDirectory}`);
