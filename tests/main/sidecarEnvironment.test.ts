import { describe, expect, test } from 'bun:test';

import { createSidecarEnvironment } from '@main/sidecar/sidecarEnvironment';

describe('createSidecarEnvironment', () => {
  test('removes inherited Copilot loader variables before spawning the sidecar', () => {
    expect(
      createSidecarEnvironment({
        PATH: 'C:\\tools',
        APPDATA: 'C:\\Users\\mail\\AppData\\Roaming',
        COPILOT_CLI: '1',
        COPILOT_LOADER_PID: '1234',
        copilot_run_app: '1',
        bun_install: 'C:\\Users\\mail\\.bun',
        NODE_OPTIONS: '--no-warnings',
        electron_run_as_node: '1',
        npm_config_user_agent: 'bun/1.3.6',
      }),
    ).toEqual({
      APPDATA: 'C:\\Users\\mail\\AppData\\Roaming',
      PATH: 'C:\\tools',
    });
  });

  test('preserves unrelated environment variables', () => {
    expect(
      createSidecarEnvironment({
        PATH: 'C:\\tools',
        HOME: 'C:\\Users\\mail',
        FORCE_COLOR: '1',
        HTTPS_PROXY: 'http://proxy.local:8080',
      }),
    ).toEqual({
      PATH: 'C:\\tools',
      HOME: 'C:\\Users\\mail',
      FORCE_COLOR: '1',
      HTTPS_PROXY: 'http://proxy.local:8080',
    });
  });

  test('injects OTEL_EXPORTER_OTLP_ENDPOINT when OpenTelemetry is enabled', () => {
    expect(
      createSidecarEnvironment(
        { PATH: 'C:\\tools' },
        { enabled: true, endpoint: 'http://localhost:4317' },
      ),
    ).toEqual({
      PATH: 'C:\\tools',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4317',
    });
  });

  test('does not inject OTEL_EXPORTER_OTLP_ENDPOINT when OpenTelemetry is disabled', () => {
    expect(
      createSidecarEnvironment(
        { PATH: 'C:\\tools' },
        { enabled: false, endpoint: 'http://localhost:4317' },
      ),
    ).toEqual({
      PATH: 'C:\\tools',
    });
  });

  test('does not inject OTEL_EXPORTER_OTLP_ENDPOINT when settings are undefined', () => {
    expect(
      createSidecarEnvironment({ PATH: 'C:\\tools' }),
    ).toEqual({
      PATH: 'C:\\tools',
    });
  });

  test('does not inject OTEL_EXPORTER_OTLP_ENDPOINT when endpoint is empty', () => {
    expect(
      createSidecarEnvironment(
        { PATH: 'C:\\tools' },
        { enabled: true, endpoint: '' },
      ),
    ).toEqual({
      PATH: 'C:\\tools',
    });
  });
});
