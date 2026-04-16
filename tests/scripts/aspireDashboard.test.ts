import { describe, expect, test } from 'bun:test';

import {
  aspireDashboardContainerName,
  aspireDashboardImage,
  aspireDashboardUrls,
  createAspireDashboardRunArgs,
  createOpenTelemetryEnvironment,
} from '../../scripts/aspireDashboard';

describe('aspire dashboard helpers', () => {
  test('creates the official standalone Docker command with mapped OTLP ports', () => {
    expect(createAspireDashboardRunArgs()).toEqual([
      'run',
      '--rm',
      '-d',
      '--name',
      aspireDashboardContainerName,
      '-p',
      '18888:18888',
      '-p',
      '4317:18889',
      '-p',
      '4318:18890',
      '-e',
      'ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true',
      aspireDashboardImage,
    ]);
  });

  test('injects OTLP exporter settings for local Aspire development', () => {
    expect(
      createOpenTelemetryEnvironment(
        {
          PATH: 'C:\\tools',
        },
        aspireDashboardUrls.otlpGrpc,
      ),
    ).toEqual({
      PATH: 'C:\\tools',
      OTEL_EXPORTER_OTLP_ENDPOINT: aspireDashboardUrls.otlpGrpc,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    });
  });
});
