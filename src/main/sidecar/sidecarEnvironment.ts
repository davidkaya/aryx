import type { OpenTelemetrySettings } from '@shared/domain/tooling';

const blockedEnvironmentPrefixes = ['BUN_', 'COPILOT_', 'ELECTRON_', 'NODE_', 'NPM_'];

export function createSidecarEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  openTelemetry?: OpenTelemetrySettings,
): NodeJS.ProcessEnv {
  const sanitizedEnvironment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(baseEnvironment)) {
    const normalizedName = name.toUpperCase();

    if (blockedEnvironmentPrefixes.some((prefix) => normalizedName.startsWith(prefix))) {
      continue;
    }

    sanitizedEnvironment[name] = value;
  }

  if (openTelemetry?.enabled && openTelemetry.endpoint) {
    sanitizedEnvironment.OTEL_EXPORTER_OTLP_ENDPOINT = openTelemetry.endpoint;
  }

  return sanitizedEnvironment;
}
