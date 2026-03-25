import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  buildDiscoveredMcpServerFingerprint,
  buildDiscoveredMcpServerId,
  mergeDiscoveredToolingState,
  normalizeDiscoveredToolingState,
  type DiscoveredMcpServer,
  type DiscoveredToolingScope,
  type DiscoveredToolingState,
} from '@shared/domain/discoveredTooling';
import { nowIso } from '@shared/utils/ids';

export interface ProjectScanContext {
  scope: 'project';
  projectId: string;
  projectPath: string;
}

export interface UserScanContext {
  scope: 'user';
  homePath: string;
}

export type ScanContext = ProjectScanContext | UserScanContext;

type ConfigScannerResult =
  | { kind: 'success'; mcpServers: DiscoveredMcpServer[] }
  | { kind: 'retain-previous' };

export interface ConfigScanner {
  readonly id: string;
  readonly scope: DiscoveredToolingScope;
  scan(context: ScanContext): Promise<ConfigScannerResult>;
}

export class ConfigScannerRegistry {
  constructor(
    private readonly scanners: ReadonlyArray<ConfigScanner> = defaultConfigScanners,
  ) {}

  async scanProject(
    projectId: string,
    projectPath: string,
    current?: DiscoveredToolingState,
  ): Promise<DiscoveredToolingState> {
    return this.scanAll(
      {
        scope: 'project',
        projectId,
        projectPath,
      },
      current,
    );
  }

  async scanUser(current?: DiscoveredToolingState, homePath = homedir()): Promise<DiscoveredToolingState> {
    return this.scanAll(
      {
        scope: 'user',
        homePath,
      },
      current,
    );
  }

  private async scanAll(context: ScanContext, current?: DiscoveredToolingState): Promise<DiscoveredToolingState> {
    const previous = normalizeDiscoveredToolingState(current);
    const previousByScanner = new Map<string, DiscoveredMcpServer[]>();

    for (const server of previous.mcpServers) {
      const entries = previousByScanner.get(server.scannerId) ?? [];
      entries.push(server);
      previousByScanner.set(server.scannerId, entries);
    }

    const scannedServers: DiscoveredMcpServer[] = [];
    for (const scanner of this.scanners) {
      if (scanner.scope !== context.scope) {
        continue;
      }

      const result = await scanner.scan(context);
      if (result.kind === 'retain-previous') {
        scannedServers.push(...(previousByScanner.get(scanner.id) ?? []));
        continue;
      }

      scannedServers.push(...result.mcpServers);
    }

    return mergeDiscoveredToolingState(previous, scannedServers, nowIso());
  }
}

const defaultConfigScanners: ReadonlyArray<ConfigScanner> = [
  createProjectJsonMcpScanner({
    id: 'vscode-mcp',
    resolvePath: (context) => join(context.projectPath, '.vscode', 'mcp.json'),
    sourceLabel: '.vscode\\mcp.json',
    rootKey: 'servers',
  }),
  createProjectJsonMcpScanner({
    id: 'claude-code-mcp',
    resolvePath: (context) => join(context.projectPath, '.mcp.json'),
    sourceLabel: '.mcp.json',
    rootKey: 'mcpServers',
  }),
  createProjectJsonMcpScanner({
    id: 'copilot-project-mcp',
    resolvePath: (context) => join(context.projectPath, '.copilot', 'mcp.json'),
    sourceLabel: '.copilot\\mcp.json',
    rootKey: 'mcpServers',
  }),
  createUserJsonMcpScanner({
    id: 'copilot-user-mcp',
    resolvePath: (context) => join(context.homePath, '.copilot', 'mcp.json'),
    sourceLabel: '~\\.copilot\\mcp.json',
    rootKey: 'mcpServers',
  }),
];

function createProjectJsonMcpScanner(options: {
  id: string;
  resolvePath: (context: ProjectScanContext) => string;
  sourceLabel: string;
  rootKey: 'servers' | 'mcpServers';
}): ConfigScanner {
  return createJsonMcpScanner('project', options);
}

function createUserJsonMcpScanner(options: {
  id: string;
  resolvePath: (context: UserScanContext) => string;
  sourceLabel: string;
  rootKey: 'servers' | 'mcpServers';
}): ConfigScanner {
  return createJsonMcpScanner('user', options);
}

function createJsonMcpScanner<TContext extends ScanContext>(scope: DiscoveredToolingScope, options: {
  id: string;
  resolvePath: (context: TContext) => string;
  sourceLabel: string;
  rootKey: 'servers' | 'mcpServers';
}): ConfigScanner {
  return {
    id: options.id,
    scope,
    async scan(context): Promise<ConfigScannerResult> {
      if (context.scope !== scope) {
        return { kind: 'success', mcpServers: [] };
      }

      const filePath = options.resolvePath(context as TContext);
      const fileContents = await readJsonConfigFile(filePath, options.sourceLabel);
      if (fileContents.kind !== 'success') {
        return fileContents;
      }

      const rawServers = extractMcpServerEntries(fileContents.value, options.rootKey);
      if (rawServers.kind !== 'success') {
        return rawServers;
      }

      const mcpServers = Object.entries(rawServers.value)
        .flatMap(([serverName, rawServerConfig]) => {
          const server = parseDiscoveredMcpServer({
            scannerId: options.id,
            sourcePath: filePath,
            sourceLabel: options.sourceLabel,
            context,
            serverName,
            rawServerConfig,
          });
          return server ? [server] : [];
        });

      return { kind: 'success', mcpServers };
    },
  };
}

async function readJsonConfigFile(
  filePath: string,
  sourceLabel: string,
): Promise<{ kind: 'success'; value: unknown } | { kind: 'retain-previous' }> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'success', value: undefined };
    }

    console.warn(`[aryx tooling] Failed to read ${sourceLabel}:`, error);
    return { kind: 'retain-previous' };
  }

  try {
    return {
      kind: 'success',
      value: JSON.parse(contents) as unknown,
    };
  } catch (error) {
    console.warn(`[aryx tooling] Failed to parse ${sourceLabel}:`, error);
    return { kind: 'retain-previous' };
  }
}

function extractMcpServerEntries(
  value: unknown,
  rootKey: 'servers' | 'mcpServers',
): { kind: 'success'; value: Record<string, unknown> } | { kind: 'retain-previous' } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      kind: 'success',
      value: {},
    };
  }

  const rawServers = (value as Record<string, unknown>)[rootKey];
  if (rawServers === undefined) {
    return {
      kind: 'success',
      value: {},
    };
  }

  if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) {
    console.warn(`[aryx tooling] Expected "${rootKey}" to be an object.`);
    return { kind: 'retain-previous' };
  }

  return {
    kind: 'success',
    value: rawServers as Record<string, unknown>,
  };
}

function parseDiscoveredMcpServer(options: {
  scannerId: string;
  sourcePath: string;
  sourceLabel: string;
  context: ScanContext;
  serverName: string;
  rawServerConfig: unknown;
}): DiscoveredMcpServer | undefined {
  const serverName = options.serverName.trim();
  if (!serverName) {
    return undefined;
  }

  if (!options.rawServerConfig || typeof options.rawServerConfig !== 'object' || Array.isArray(options.rawServerConfig)) {
    console.warn(`[aryx tooling] Ignoring invalid MCP server "${serverName}" from ${options.sourceLabel}.`);
    return undefined;
  }

  const config = substituteScanVariables(
    options.rawServerConfig as Record<string, unknown>,
    options.context,
  ) as Record<string, unknown>;
  const rawType = normalizeOptionalString(config.type);
  const command = normalizeOptionalString(config.command);
  const url = normalizeOptionalString(config.url);
  const tools = normalizeStringArray(config.tools);
  const timeoutMs = normalizeOptionalNumber(config.timeoutMs ?? config.timeout);
  const scopeKey = options.context.scope === 'project' ? options.context.projectId : 'workspace';
  const id = buildDiscoveredMcpServerId(options.context.scope, scopeKey, options.scannerId, serverName);

  if (rawType === 'http' || rawType === 'sse' || (!rawType && url)) {
    if (!url) {
      console.warn(`[aryx tooling] Ignoring MCP server "${serverName}" from ${options.sourceLabel}: missing URL.`);
      return undefined;
    }

    const server: DiscoveredMcpServer = {
      id,
      name: serverName,
      transport: rawType === 'sse' ? 'sse' : 'http',
      tools,
      timeoutMs,
      scope: options.context.scope,
      scannerId: options.scannerId,
      sourcePath: options.sourcePath,
      sourceLabel: options.sourceLabel,
      url,
      headers: normalizeStringRecord(config.headers),
      fingerprint: '',
      status: 'pending',
    };

    return {
      ...server,
      fingerprint: buildDiscoveredMcpServerFingerprint(server),
    };
  }

  if (!command) {
    console.warn(`[aryx tooling] Ignoring MCP server "${serverName}" from ${options.sourceLabel}: missing command.`);
    return undefined;
  }

  const server: DiscoveredMcpServer = {
    id,
    name: serverName,
    transport: 'local',
    tools,
    timeoutMs,
    scope: options.context.scope,
    scannerId: options.scannerId,
    sourcePath: options.sourcePath,
    sourceLabel: options.sourceLabel,
    command,
    args: normalizeStringArray(config.args),
    cwd: normalizeOptionalString(config.cwd),
    env: normalizeStringRecord(config.env),
    fingerprint: '',
    status: 'pending',
  };

  return {
    ...server,
    fingerprint: buildDiscoveredMcpServerFingerprint(server),
  };
}

function substituteScanVariables(value: unknown, context: ScanContext): unknown {
  if (typeof value === 'string') {
    return context.scope === 'project'
      ? value.replaceAll('${workspaceFolder}', context.projectPath)
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => substituteScanVariables(item, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        substituteScanVariables(nestedValue, context),
      ]),
    );
  }

  return value;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((item) => normalizeOptionalString(item))
      .filter((item): item is string => item !== undefined),
  )];
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, rawValue]) => {
      const normalizedKey = key.trim();
      const normalizedValue = normalizeOptionalString(rawValue);
      return [normalizedKey, normalizedValue] as const;
    })
    .filter(([key, normalizedValue]) => key.length > 0 && normalizedValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return undefined;
  }

  const normalized = `${value}`.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
