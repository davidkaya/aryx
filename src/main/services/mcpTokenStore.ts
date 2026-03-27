/**
 * In-memory OAuth token store keyed by MCP server URL.
 * Tokens are lost on app restart by design (phase 1).
 */

export interface McpOAuthToken {
  accessToken: string;
  tokenType: string;
  expiresAt?: number;
  refreshToken?: string;
  scope?: string;
}

const tokens = new Map<string, McpOAuthToken>();

export function getStoredToken(serverUrl: string): McpOAuthToken | undefined {
  const token = tokens.get(normalizeUrl(serverUrl));
  if (!token) {
    return undefined;
  }

  if (token.expiresAt && Date.now() >= token.expiresAt) {
    tokens.delete(normalizeUrl(serverUrl));
    return undefined;
  }

  return token;
}

export function storeToken(serverUrl: string, token: McpOAuthToken): void {
  tokens.set(normalizeUrl(serverUrl), token);
}

export function clearToken(serverUrl: string): void {
  tokens.delete(normalizeUrl(serverUrl));
}

export function clearAllTokens(): void {
  tokens.clear();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Constructs a well-known URL per RFC 9728 Section 3.
 * The `.well-known/{suffix}` segment is inserted between the origin and the path.
 *
 * Example: `buildWellKnownUrl('https://api.example.com/mcp/', 'oauth-protected-resource')`
 *   → `https://api.example.com/.well-known/oauth-protected-resource/mcp/`
 */
export function buildWellKnownUrl(baseUrl: string, wellKnownSuffix: string): string {
  const parsed = new URL(baseUrl);
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.origin}/.well-known/${wellKnownSuffix}${path}`;
}
