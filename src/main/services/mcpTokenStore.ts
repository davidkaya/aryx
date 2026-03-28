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
 * Constructs well-known URL candidates for a given base URL.
 * Returns the RFC 9728 compliant URL first (inserted after origin),
 * then the appended fallback (some servers use this instead).
 *
 * RFC 9728: `https://example.com/.well-known/oauth-protected-resource/mcp/`
 * Fallback: `https://example.com/mcp/.well-known/oauth-protected-resource`
 */
export function buildWellKnownUrl(baseUrl: string, wellKnownSuffix: string): string {
  const parsed = new URL(baseUrl);
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.origin}/.well-known/${wellKnownSuffix}${path}`;
}

export function buildWellKnownUrlFallback(baseUrl: string, wellKnownSuffix: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/.well-known/${wellKnownSuffix}`;
}

export function buildWellKnownUrlOriginOnly(baseUrl: string, wellKnownSuffix: string): string {
  const parsed = new URL(baseUrl);
  return `${parsed.origin}/.well-known/${wellKnownSuffix}`;
}
