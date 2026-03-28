import { beforeEach, describe, expect, mock, test } from 'bun:test';

const commandDelaysMs = new Map<string, number>();
let activeListTools = 0;
let maxActiveListTools = 0;

class FakeStdioClientTransport {
  readonly command: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly stderr?: 'ignore';
  onmessage?: (message: unknown) => void;

  constructor(options: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    stderr?: 'ignore';
  }) {
    this.command = options.command;
    this.args = options.args;
    this.env = options.env;
    this.cwd = options.cwd;
    this.stderr = options.stderr;
  }

  async send(_message: unknown): Promise<void> {}
}

class FakeSSEClientTransport {
  onmessage?: (message: unknown) => void;

  constructor(_url: URL, _options?: unknown) {}

  async send(_message: unknown): Promise<void> {}
}

class FakeStreamableHTTPClientTransport {
  onmessage?: (message: unknown) => void;

  constructor(_url: URL, _options?: unknown) {}

  async send(_message: unknown): Promise<void> {}
}

class FakeClient {
  private transport?: FakeStdioClientTransport;

  constructor(_clientInfo: unknown, _options: unknown) {}

  async connect(transport: FakeStdioClientTransport): Promise<void> {
    this.transport = transport;
  }

  async listTools(): Promise<{ tools: Array<{ name: string }> }> {
    const command = this.transport?.command;
    if (!command) {
      throw new Error('Expected a command for the fake MCP transport.');
    }

    activeListTools += 1;
    maxActiveListTools = Math.max(maxActiveListTools, activeListTools);
    await new Promise((resolve) => setTimeout(resolve, commandDelaysMs.get(command) ?? 0));
    activeListTools -= 1;

    return {
      tools: [{ name: `${command}.tool` }],
    };
  }

  async close(): Promise<void> {}
}

mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: FakeClient,
}));

mock.module('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: FakeStdioClientTransport,
}));

mock.module('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: FakeSSEClientTransport,
}));

mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: FakeStreamableHTTPClientTransport,
}));

const { probeServers } = await import('../../src/main/services/mcpToolProber');

const TIMESTAMP = '2026-03-28T00:00:00.000Z';

beforeEach(() => {
  commandDelaysMs.clear();
  activeListTools = 0;
  maxActiveListTools = 0;
});

describe('probeServers', () => {
  test('fires onResult as probes finish while preserving input order and concurrency limit', async () => {
    const servers = Array.from({ length: 7 }, (_, index) => ({
      id: `server-${index}`,
      name: `Server ${index}`,
      transport: 'local' as const,
      command: `cmd-${index}`,
      args: [] as string[],
      tools: [] as string[],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    }));

    const delays = [70, 60, 50, 40, 30, 20, 10];
    for (const [index, server] of servers.entries()) {
      commandDelaysMs.set(server.command, delays[index] ?? 0);
    }

    const callbackOrder: string[] = [];
    const results = await probeServers(servers, undefined, (result) => {
      callbackOrder.push(result.serverId);
    });

    expect(results.map((result) => result.serverId)).toEqual(servers.map((server) => server.id));
    expect(results.map((result) => result.tools[0]?.name)).toEqual(
      servers.map((server) => `${server.command}.tool`),
    );
    expect(callbackOrder).not.toEqual(servers.map((server) => server.id));
    expect([...callbackOrder].sort()).toEqual(servers.map((server) => server.id).sort());
    expect(maxActiveListTools).toBe(5);
  });
});
