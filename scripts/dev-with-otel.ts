import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createOpenTelemetryEnvironment,
  startAspireDashboard,
  stopAspireDashboard,
} from './aspireDashboard';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const signalExitCodes: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

const dashboard = await startAspireDashboard();

console.log(`Aspire Dashboard: ${dashboard.dashboardUrl}`);
console.log(`Aryx sidecar OTLP endpoint: ${dashboard.otlpGrpcEndpoint}`);

const child = spawn(process.execPath, ['run', 'dev'], {
  cwd: repositoryRoot,
  env: createOpenTelemetryEnvironment(process.env, dashboard.otlpGrpcEndpoint),
  stdio: 'inherit',
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  });
}

let exitResult: { code: number | null; signal: NodeJS.Signals | null };

try {
  exitResult = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
} finally {
  if (dashboard.startedByScript) {
    await stopAspireDashboard();
  }
}

if (exitResult.signal) {
  process.exitCode = signalExitCodes[exitResult.signal] ?? 1;
} else {
  process.exitCode = exitResult.code ?? 1;
}
