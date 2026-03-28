import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import type { McpServerDefinition } from '@shared/domain/tooling';

export interface McpProbedTool {
  name: string;
  description?: string;
}

export interface McpProbeResult {
  serverId: string;
  serverName: string;
  tools: McpProbedTool[];
  status: 'success' | 'failed';
  error?: string;
}

const CLIENT_INFO = { name: 'aryx', version: '1.0.0' };
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 5;

export async function probeServers(
  servers: ReadonlyArray<McpServerDefinition>,
  tokenLookup?: (serverUrl: string) => string | undefined,
  onResult?: (result: McpProbeResult) => void | Promise<void>,
): Promise<McpProbeResult[]> {
  if (servers.length === 0) {
    return [];
  }

  const results = new Array<McpProbeResult>(servers.length);
  let nextIndex = 0;
  const workerCount = Math.min(MAX_CONCURRENCY, servers.length);

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const server = servers[index];
      if (!server) {
        return;
      }

      const result = await probeServer(server, tokenLookup);
      results[index] = result;
      await onResult?.(result);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function probeServer(
  server: McpServerDefinition,
  tokenLookup?: (serverUrl: string) => string | undefined,
): Promise<McpProbeResult> {
  const timeoutMs = server.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const tools = await withTimeout(
      probeServerCore(server, tokenLookup),
      timeoutMs,
      `Probe timed out after ${timeoutMs}ms`,
    );

    console.log(`[aryx mcp-probe] ${server.name}: discovered ${tools.length} tool(s)`);
    return {
      serverId: server.id,
      serverName: server.name,
      tools,
      status: 'success',
    };
  } catch (error) {
    const message = formatProbeError(error);
    console.warn(`[aryx mcp-probe] ${server.name}: failed — ${message}`);
    return {
      serverId: server.id,
      serverName: server.name,
      tools: [],
      status: 'failed',
      error: message,
    };
  }
}

async function probeServerCore(
  server: McpServerDefinition,
  tokenLookup?: (serverUrl: string) => string | undefined,
): Promise<McpProbedTool[]> {
  if (server.transport === 'local' || server.transport === 'sse') {
    return probeWithTransport(createTransport(server, tokenLookup));
  }

  // For HTTP servers, try Streamable HTTP first, then fall back to SSE.
  // Many MCP servers only support SSE despite being configured as generic HTTP.
  const headers = buildHeaders(server.url, server.headers, tokenLookup);
  const headerOpts = headers ? { requestInit: { headers } } : undefined;

  try {
    return await probeWithTransport(
      new StreamableHTTPClientTransport(new URL(server.url), headerOpts),
    );
  } catch (streamableError) {
    try {
      return await probeWithTransport(
        new SSEClientTransport(new URL(server.url), headerOpts),
      );
    } catch (sseError) {
      // SSE 405 means the server IS Streamable HTTP — surface the original error.
      const sseCode = (sseError as { code?: number }).code;
      if (sseCode === 405) throw streamableError;
      throw sseError;
    }
  }
}

async function probeWithTransport(
  transport: InstanceType<typeof StdioClientTransport> | InstanceType<typeof SSEClientTransport> | InstanceType<typeof StreamableHTTPClientTransport>,
): Promise<McpProbedTool[]> {
  const client = new Client(CLIENT_INFO, { capabilities: {} });

  try {
    await client.connect(transport);

    // Use listTools() which validates schemas. If a tool has a complex
    // outputSchema with $ref that the SDK can't resolve, fall back to
    // a raw JSON-RPC request that skips schema compilation.
    let rawTools: Array<{ name?: string; description?: string }>;
    try {
      const result = await client.listTools();
      rawTools = result.tools ?? [];
    } catch {
      // listTools failed (likely schema validation of outputSchema $ref).
      // Send raw JSON-RPC and extract tool names without validation.
      const response = await new Promise<{ tools?: Array<{ name?: string; description?: string }> }>((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        const onMessage = (msg: { id?: string; result?: unknown; error?: unknown }) => {
          if (msg.id !== id) return;
          transport.onmessage = undefined;
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve((msg.result ?? {}) as { tools?: Array<{ name?: string; description?: string }> });
        };
        const prevHandler = transport.onmessage;
        transport.onmessage = (msg) => {
          onMessage(msg as { id?: string; result?: unknown; error?: unknown });
          if (prevHandler) (prevHandler as (msg: unknown) => void)(msg);
        };
        transport.send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }).catch(reject);
      });
      rawTools = response.tools ?? [];
    }

    return rawTools
      .filter((tool) => typeof tool.name === 'string' && tool.name.trim().length > 0)
      .map((tool) => ({
        name: tool.name!.trim(),
        description: typeof tool.description === 'string' && tool.description.trim().length > 0
          ? tool.description.trim()
          : undefined,
      }));
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors — connection may already be closed
    }
  }
}

function createTransport(
  server: McpServerDefinition,
  tokenLookup?: (serverUrl: string) => string | undefined,
) {
  if (server.transport === 'local') {
    return new StdioClientTransport({
      command: server.command,
      args: server.args.length > 0 ? server.args : undefined,
      env: server.env
        ? Object.fromEntries(
          Object.entries({ ...process.env, ...server.env })
            .filter((entry): entry is [string, string] => entry[1] !== undefined),
        )
        : undefined,
      cwd: server.cwd,
      stderr: 'ignore',
    });
  }

  const headers = buildHeaders(server.url, server.headers, tokenLookup);
  return new SSEClientTransport(
    new URL(server.url),
    headers ? { requestInit: { headers } } : undefined,
  );
}

function buildHeaders(
  serverUrl: string,
  configHeaders?: Record<string, string>,
  tokenLookup?: (serverUrl: string) => string | undefined,
): Record<string, string> | undefined {
  const bearerToken = tokenLookup?.(serverUrl);
  if (!bearerToken && !configHeaders) {
    return undefined;
  }

  return {
    ...(configHeaders ?? {}),
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
  };
}

function formatProbeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const httpCode = (error as { code?: number }).code;
  const base = error.message;

  if (typeof httpCode === 'number' && httpCode >= 100) {
    return `HTTP ${httpCode}: ${base}`;
  }

  return base;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
