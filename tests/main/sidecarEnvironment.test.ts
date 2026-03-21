import { describe, expect, test } from 'bun:test';

import { createSidecarEnvironment } from '@main/sidecar/sidecarEnvironment';

describe('createSidecarEnvironment', () => {
  test('removes inherited Copilot loader variables before spawning the sidecar', () => {
    expect(
      createSidecarEnvironment({
        PATH: 'C:\\tools',
        COPILOT_CLI: '1',
        COPILOT_LOADER_PID: '1234',
        copilot_run_app: '1',
        NODE_OPTIONS: '--no-warnings',
        electron_run_as_node: '1',
      }),
    ).toEqual({
      PATH: 'C:\\tools',
    });
  });

  test('preserves unrelated environment variables', () => {
    expect(
      createSidecarEnvironment({
        PATH: 'C:\\tools',
        HOME: 'C:\\Users\\mail',
        FORCE_COLOR: '1',
      }),
    ).toEqual({
      PATH: 'C:\\tools',
      HOME: 'C:\\Users\\mail',
      FORCE_COLOR: '1',
    });
  });
});
