import type { McpServerDefinition, LspProfileDefinition } from '@shared/domain/tooling';
import { nowIso } from '@shared/utils/ids';

export function updateMcpServer<T extends McpServerDefinition>(
  server: T,
  patch: Partial<T>,
): T {
  return { ...server, ...patch, updatedAt: nowIso() } as T;
}

export function changeMcpTransport(
  server: McpServerDefinition,
  transport: McpServerDefinition['transport'],
): McpServerDefinition {
  if (transport === server.transport) return server;

  if (transport === 'local') {
    return {
      id: server.id,
      name: server.name,
      transport: 'local',
      command: '',
      args: [],
      cwd: undefined,
      tools: server.tools,
      timeoutMs: server.timeoutMs,
      createdAt: server.createdAt,
      updatedAt: nowIso(),
    };
  }

  return {
    id: server.id,
    name: server.name,
    transport,
    url: server.transport === 'local' ? '' : server.url,
    tools: server.tools,
    timeoutMs: server.timeoutMs,
    createdAt: server.createdAt,
    updatedAt: nowIso(),
  };
}

export function updateLspProfile(
  profile: LspProfileDefinition,
  patch: Partial<LspProfileDefinition>,
): LspProfileDefinition {
  return { ...profile, ...patch, updatedAt: nowIso() };
}

export function splitMultiline(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function splitTokens(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function joinMultiline(value: string[]): string {
  return value.join('\n');
}
