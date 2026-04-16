import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export const aspireDashboardContainerName = 'aryx-aspire-dashboard';
export const aspireDashboardImage = 'mcr.microsoft.com/dotnet/aspire-dashboard:latest';
export const aspireDashboardUrls = {
  dashboard: 'http://localhost:18888',
  otlpGrpc: 'http://localhost:4317',
  otlpHttp: 'http://localhost:4318',
} as const;

type ContainerState = 'missing' | 'running' | 'stopped';

export interface AspireDashboardHandle {
  readonly dashboardUrl: string;
  readonly otlpGrpcEndpoint: string;
  readonly otlpHttpEndpoint: string;
  readonly startedByScript: boolean;
}

export function createAspireDashboardRunArgs(
  containerName = aspireDashboardContainerName,
  image = aspireDashboardImage,
): string[] {
  return [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '-p',
    '18888:18888',
    '-p',
    '4317:18889',
    '-p',
    '4318:18890',
    '-e',
    'ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true',
    image,
  ];
}

export function createOpenTelemetryEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  endpoint: string = aspireDashboardUrls.otlpGrpc,
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
  };
}

export async function startAspireDashboard(): Promise<AspireDashboardHandle> {
  await ensureDockerAvailable();

  let startedByScript = false;
  const containerState = await getContainerState(aspireDashboardContainerName);
  if (containerState !== 'running') {
    if (containerState === 'stopped') {
      await runCommand('docker', ['rm', '-f', aspireDashboardContainerName], 'pipe');
    }

    await runCommand('docker', createAspireDashboardRunArgs(), 'pipe');
    startedByScript = true;
  }

  await waitForTcpPort(18888);
  await waitForTcpPort(4317);

  return {
    dashboardUrl: aspireDashboardUrls.dashboard,
    otlpGrpcEndpoint: aspireDashboardUrls.otlpGrpc,
    otlpHttpEndpoint: aspireDashboardUrls.otlpHttp,
    startedByScript,
  };
}

export async function stopAspireDashboard(): Promise<void> {
  const containerState = await getContainerState(aspireDashboardContainerName);
  if (containerState === 'missing') {
    return;
  }

  await runCommand('docker', ['rm', '-f', aspireDashboardContainerName], 'pipe');
}

async function ensureDockerAvailable(): Promise<void> {
  const cliVersion = await runCommandCapture('docker', ['--version']);
  if (cliVersion.exitCode !== 0) {
    throw new Error(
      'Docker is required to run the standalone Aspire Dashboard. Install Docker Desktop and ensure `docker` is available on PATH.',
    );
  }

  if (await isDockerDaemonAvailable()) {
    return;
  }

  if (await hasDockerDesktopCli()) {
    console.log('Docker Desktop is not running. Starting it now...');
    await runCommand('docker', ['desktop', 'start', '--detach'], 'pipe');
    await waitForDockerDaemon();
    return;
  }

  throw new Error(
    'Docker is installed but the daemon is not running. Start Docker Desktop and rerun the Aspire command.',
  );
}

async function getContainerState(containerName: string): Promise<ContainerState> {
  const result = await runCommandCapture('docker', [
    'container',
    'inspect',
    '--format',
    '{{.State.Status}}',
    containerName,
  ]);

  if (result.exitCode !== 0) {
    return 'missing';
  }

  return result.stdout.trim() === 'running' ? 'running' : 'stopped';
}

async function waitForTcpPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      return;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for localhost:${port} to accept connections.`);
}

async function isDockerDaemonAvailable(): Promise<boolean> {
  const result = await runCommandCapture('docker', ['info', '--format', '{{.ServerVersion}}']);
  return result.exitCode === 0;
}

async function hasDockerDesktopCli(): Promise<boolean> {
  const result = await runCommandCapture('docker', ['desktop', 'version']);
  return result.exitCode === 0;
}

async function waitForDockerDaemon(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDockerDaemonAvailable()) {
      return;
    }

    await delay(1_000);
  }

  throw new Error('Timed out waiting for Docker Desktop to start and accept API connections.');
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finalize = (connected: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };

    socket.once('connect', () => finalize(true));
    socket.once('error', () => finalize(false));
  });
}

async function runCommand(command: string, args: string[], stdio: 'inherit' | 'pipe'): Promise<void> {
  const result = await spawnProcess(command, args, stdio);
  if (result.exitCode === 0) {
    return;
  }

  if (result.stderr.trim().length > 0) {
    throw new Error(result.stderr.trim());
  }

  throw new Error(`${command} exited with code ${result.exitCode}.`);
}

async function runCommandCapture(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return spawnProcess(command, args, 'pipe');
}

async function spawnProcess(
  command: string,
  args: string[],
  stdio: 'inherit' | 'pipe',
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    if (stdio === 'pipe') {
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited because of signal ${signal}.`));
        return;
      }

      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
