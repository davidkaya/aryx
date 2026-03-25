import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigScannerRegistry } from '@main/services/configScanner';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aryx-config-scanner-'));
  temporaryPaths.push(directory);
  return directory;
}

describe('ConfigScannerRegistry', () => {
  test('scans supported project-level MCP config formats', async () => {
    const projectPath = await createTempDirectory();
    await mkdir(join(projectPath, '.vscode'), { recursive: true });
    await mkdir(join(projectPath, '.copilot'), { recursive: true });

    await writeFile(
      join(projectPath, '.vscode', 'mcp.json'),
      JSON.stringify({
        servers: {
          filesystem: {
            command: 'node',
            args: ['${workspaceFolder}\\server.js'],
            cwd: '${workspaceFolder}',
            env: { DEBUG: 'true' },
            tools: ['fs.read'],
          },
        },
      }),
      'utf8',
    );
    await writeFile(
      join(projectPath, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          remote: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer token' },
            tools: ['remote.tool'],
          },
        },
      }),
      'utf8',
    );
    await writeFile(
      join(projectPath, '.copilot', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          local: {
            command: 'python',
            args: ['tool.py'],
            timeout: 1500,
          },
        },
      }),
      'utf8',
    );

    const scanned = await new ConfigScannerRegistry().scanProject('project-alpha', projectPath);

    expect(scanned.mcpServers).toHaveLength(3);
    expect(scanned.mcpServers).toContainEqual({
      id: 'discovered_project_project_alpha_vscode_mcp_filesystem',
      name: 'filesystem',
      transport: 'local',
      command: 'node',
      args: [`${projectPath}\\server.js`],
      cwd: projectPath,
      env: { DEBUG: 'true' },
      tools: ['fs.read'],
      scope: 'project',
      scannerId: 'vscode-mcp',
      sourcePath: join(projectPath, '.vscode', 'mcp.json'),
      sourceLabel: '.vscode\\mcp.json',
      fingerprint: expect.any(String),
      status: 'pending',
    });
    expect(scanned.mcpServers).toContainEqual({
      id: 'discovered_project_project_alpha_claude_code_mcp_remote',
      name: 'remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      tools: ['remote.tool'],
      scope: 'project',
      scannerId: 'claude-code-mcp',
      sourcePath: join(projectPath, '.mcp.json'),
      sourceLabel: '.mcp.json',
      fingerprint: expect.any(String),
      status: 'pending',
    });
    expect(scanned.mcpServers).toContainEqual({
      id: 'discovered_project_project_alpha_copilot_project_mcp_local',
      name: 'local',
      transport: 'local',
      command: 'python',
      args: ['tool.py'],
      tools: [],
      timeoutMs: 1500,
      scope: 'project',
      scannerId: 'copilot-project-mcp',
      sourcePath: join(projectPath, '.copilot', 'mcp.json'),
      sourceLabel: '.copilot\\mcp.json',
      fingerprint: expect.any(String),
      status: 'pending',
    });
  });

  test('scans user-level Copilot MCP config files', async () => {
    const homePath = await createTempDirectory();
    await mkdir(join(homePath, '.copilot'), { recursive: true });
    await writeFile(
      join(homePath, '.copilot', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'gh',
            args: ['aw', 'mcp-server'],
          },
        },
      }),
      'utf8',
    );

    const scanned = await new ConfigScannerRegistry().scanUser(undefined, homePath);

    expect(scanned.mcpServers).toEqual([
      {
        id: 'discovered_user_workspace_copilot_user_mcp_github',
        name: 'github',
        transport: 'local',
        command: 'gh',
        args: ['aw', 'mcp-server'],
        tools: [],
        scope: 'user',
        scannerId: 'copilot-user-mcp',
        sourcePath: join(homePath, '.copilot', 'mcp.json'),
        sourceLabel: '~\\.copilot\\mcp.json',
        fingerprint: expect.any(String),
        status: 'pending',
      },
    ]);
  });

  test('retains previous scanner results when a config file becomes malformed', async () => {
    const projectPath = await createTempDirectory();
    await mkdir(join(projectPath, '.vscode'), { recursive: true });
    const filePath = join(projectPath, '.vscode', 'mcp.json');

    await writeFile(
      filePath,
      JSON.stringify({
        servers: {
          filesystem: {
            command: 'node',
            args: ['server.js'],
          },
        },
      }),
      'utf8',
    );

    const registry = new ConfigScannerRegistry();
    const firstScan = await registry.scanProject('project-alpha', projectPath);

    await writeFile(filePath, '{ invalid json', 'utf8');

    const secondScan = await registry.scanProject('project-alpha', projectPath, firstScan);

    expect(secondScan.mcpServers).toEqual(firstScan.mcpServers);
  });
});
