export type DiscoveredToolingScope = 'user' | 'project';
export type DiscoveredToolingStatus = 'pending' | 'accepted' | 'dismissed';
export type DiscoveredMcpServerTransport = 'local' | 'http' | 'sse';

export interface BaseDiscoveredMcpServer {
  id: string;
  name: string;
  transport: DiscoveredMcpServerTransport;
  tools: string[];
  probedTools?: { name: string; description?: string }[];
  timeoutMs?: number;
  scope: DiscoveredToolingScope;
  scannerId: string;
  sourcePath: string;
  sourceLabel: string;
  fingerprint: string;
  status: DiscoveredToolingStatus;
}

export interface DiscoveredLocalMcpServer extends BaseDiscoveredMcpServer {
  transport: 'local';
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface DiscoveredRemoteMcpServer extends BaseDiscoveredMcpServer {
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type DiscoveredMcpServer = DiscoveredLocalMcpServer | DiscoveredRemoteMcpServer;

export interface DiscoveredToolingState {
  mcpServers: DiscoveredMcpServer[];
  lastScannedAt?: string;
}

export type ProjectDiscoveredTooling = DiscoveredToolingState;

type DiscoveredMcpServerFingerprintInput =
  | Omit<DiscoveredLocalMcpServer, 'fingerprint' | 'status'>
  | Omit<DiscoveredRemoteMcpServer, 'fingerprint' | 'status'>
  | DiscoveredLocalMcpServer
  | DiscoveredRemoteMcpServer;

const discoveredStatuses: ReadonlySet<DiscoveredToolingStatus> = new Set(['pending', 'accepted', 'dismissed']);

export function createDiscoveredToolingState(): DiscoveredToolingState {
  return {
    mcpServers: [],
  };
}

export function normalizeDiscoveredToolingState(
  value?: Partial<DiscoveredToolingState>,
): DiscoveredToolingState {
  return {
    mcpServers: (value?.mcpServers ?? []).map(normalizeDiscoveredMcpServer).sort(compareDiscoveredMcpServers),
    lastScannedAt: normalizeOptionalString(value?.lastScannedAt),
  };
}

export function normalizeDiscoveredMcpServer(server: DiscoveredMcpServer): DiscoveredMcpServer {
  const normalizedStatus = discoveredStatuses.has(server.status) ? server.status : 'pending';
  const normalizedBase = {
    ...server,
    id: server.id.trim(),
    name: server.name.trim(),
    tools: normalizeStringArray(server.tools),
    scope: server.scope === 'user' ? 'user' : 'project',
    scannerId: server.scannerId.trim(),
    sourcePath: server.sourcePath.trim(),
    sourceLabel: server.sourceLabel.trim(),
    status: normalizedStatus,
  } satisfies BaseDiscoveredMcpServer;

  if (server.transport === 'local') {
    const normalizedServer: DiscoveredLocalMcpServer = {
      ...normalizedBase,
      transport: 'local',
      command: server.command.trim(),
      args: normalizeStringArray(server.args),
      cwd: normalizeOptionalString(server.cwd),
      env: normalizeStringRecord(server.env),
    };

    return {
      ...normalizedServer,
      fingerprint: normalizeOptionalString(server.fingerprint) ?? buildDiscoveredMcpServerFingerprint(normalizedServer),
    };
  }

  const normalizedServer: DiscoveredRemoteMcpServer = {
    ...normalizedBase,
    transport: server.transport,
    url: server.url.trim(),
    headers: normalizeStringRecord(server.headers),
  };

  return {
    ...normalizedServer,
    fingerprint: normalizeOptionalString(server.fingerprint) ?? buildDiscoveredMcpServerFingerprint(normalizedServer),
  };
}

export function mergeDiscoveredToolingState(
  current: DiscoveredToolingState | undefined,
  scannedMcpServers: ReadonlyArray<DiscoveredMcpServer>,
  lastScannedAt: string,
): DiscoveredToolingState {
  const normalizedCurrent = normalizeDiscoveredToolingState(current);
  const currentById = new Map(normalizedCurrent.mcpServers.map((server) => [server.id, server]));

  const mergedMcpServers = scannedMcpServers
    .map(normalizeDiscoveredMcpServer)
    .map((server) => {
      const existing = currentById.get(server.id);
      if (existing && existing.fingerprint === server.fingerprint) {
        return {
          ...server,
          status: existing.status,
          probedTools: existing.probedTools,
        } satisfies DiscoveredMcpServer;
      }

      return {
        ...server,
        status: 'pending',
      } satisfies DiscoveredMcpServer;
    })
    .sort(compareDiscoveredMcpServers);

  return {
    mcpServers: mergedMcpServers,
    lastScannedAt,
  };
}

export function applyDiscoveredMcpServerStatus(
  state: DiscoveredToolingState | undefined,
  serverIds: ReadonlyArray<string>,
  status: Exclude<DiscoveredToolingStatus, 'pending'>,
): DiscoveredToolingState {
  const normalizedState = normalizeDiscoveredToolingState(state);
  const serverIdSet = new Set(normalizeStringArray(serverIds));

  return {
    ...normalizedState,
    mcpServers: normalizedState.mcpServers.map((server) =>
      serverIdSet.has(server.id)
        ? {
            ...server,
            status,
          }
        : server),
  };
}

export function listAcceptedDiscoveredMcpServers(
  state?: Partial<DiscoveredToolingState>,
): DiscoveredMcpServer[] {
  return normalizeDiscoveredToolingState(state).mcpServers.filter((server) => server.status === 'accepted');
}

export function listPendingDiscoveredMcpServers(
  state?: Partial<DiscoveredToolingState>,
): DiscoveredMcpServer[] {
  return normalizeDiscoveredToolingState(state).mcpServers.filter((server) => server.status === 'pending');
}

export function buildDiscoveredMcpServerId(
  scope: DiscoveredToolingScope,
  scopeKey: string,
  scannerId: string,
  serverName: string,
): string {
  const normalizedScope = normalizeIdentifierSegment(scope);
  const normalizedScopeKey = normalizeIdentifierSegment(scopeKey);
  const normalizedScanner = normalizeIdentifierSegment(scannerId);
  const normalizedName = normalizeIdentifierSegment(serverName);
  return `discovered_${normalizedScope}_${normalizedScopeKey}_${normalizedScanner}_${normalizedName}`;
}

export function buildDiscoveredMcpServerFingerprint(
  server: DiscoveredMcpServerFingerprintInput,
): string {
  const normalizedBase = {
    id: server.id.trim(),
    name: server.name.trim(),
    transport: server.transport,
    tools: normalizeStringArray(server.tools),
    timeoutMs: server.timeoutMs,
    scope: server.scope === 'user' ? 'user' : 'project',
    scannerId: server.scannerId.trim(),
    sourcePath: server.sourcePath.trim(),
  };

  const serialized = server.transport === 'local'
    ? stableSerialize({
        ...normalizedBase,
        command: server.command.trim(),
        args: normalizeStringArray(server.args),
        cwd: normalizeOptionalString(server.cwd),
        env: normalizeStringRecord(server.env),
      })
    : stableSerialize({
        ...normalizedBase,
        url: server.url.trim(),
        headers: normalizeStringRecord(server.headers),
      });

  return hashString(serialized);
}

function compareDiscoveredMcpServers(left: DiscoveredMcpServer, right: DiscoveredMcpServer): number {
  return (
    left.scope.localeCompare(right.scope)
    || left.sourceLabel.localeCompare(right.sourceLabel)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  );
}

function normalizeStringArray(values?: ReadonlyArray<string>): string[] {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeStringRecord(record?: Record<string, string>): Record<string, string> | undefined {
  if (!record) {
    return undefined;
  }

  const normalizedEntries = Object.entries(record)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeIdentifierSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'default';
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return `{${entries.map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
