import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

import { shell } from 'electron';

import type { McpOauthStaticClientConfig } from '@shared/domain/mcpAuth';

import { storeToken, buildWellKnownUrl, buildWellKnownUrlFallback, type McpOAuthToken } from './mcpTokenStore';

/* ── Public API ──────────────────────────────────────────────── */

export interface McpOAuthFlowOptions {
  serverUrl: string;
  staticClientConfig?: McpOauthStaticClientConfig;
  onStatusChange?: (status: 'discovering' | 'awaiting-consent' | 'exchanging') => void;
}

export interface McpOAuthFlowResult {
  success: boolean;
  token?: McpOAuthToken;
  error?: string;
}

/**
 * Probes an MCP server URL to determine if it requires OAuth authentication.
 * Returns true if the server responds with 401 and has discoverable OAuth metadata.
 */
export async function requiresOAuth(serverUrl: string): Promise<boolean> {
  try {
    const metadata = await fetchWellKnownMetadata(serverUrl, 'oauth-protected-resource');
    if (!metadata) {
      console.log(`[aryx oauth] No PRM found for ${serverUrl}`);
      return false;
    }

    const hasAuthServers = Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length > 0;
    console.log(`[aryx oauth] PRM found for ${serverUrl}: authorization_servers=${hasAuthServers}`);
    return hasAuthServers;
  } catch (err) {
    console.warn(`[aryx oauth] Probe failed for ${serverUrl}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Performs the full MCP OAuth 2.1 + PKCE flow:
 * 1. Discover protected resource metadata (RFC 9728)
 * 2. Fetch authorization server metadata (RFC 8414)
 * 3. Resolve client ID (static config or dynamic registration per RFC 7591)
 * 4. PKCE code verifier + challenge
 * 5. Open browser for user consent
 * 6. Local callback server receives auth code
 * 7. Exchange code for token
 */
export async function performMcpOAuthFlow(options: McpOAuthFlowOptions): Promise<McpOAuthFlowResult> {
  const { serverUrl, staticClientConfig, onStatusChange } = options;

  try {
    onStatusChange?.('discovering');

    const prm = await discoverProtectedResource(serverUrl);
    const metadata = await fetchAuthServerMetadata(prm.authorizationServer);

    // Use explicit static config, fall back to the well-known GitHub Copilot client ID,
    // and only attempt dynamic registration as a last resort.
    const COPILOT_CLIENT_ID = 'aebc6443-996d-45c2-90f0-388ff96faa56';
    const VSCODE_REDIRECT_URI = 'https://vscode.dev/redirect';

    const clientId = staticClientConfig?.clientId
      ?? (metadata.registration_endpoint
        ? await dynamicClientRegistration(metadata, serverUrl)
        : COPILOT_CLIENT_ID);

    const useCopilotRedirect = clientId === COPILOT_CLIENT_ID;

    const { verifier, challenge } = generatePkceChallenge();
    const { redirectUri: localRedirectUri, waitForCallback, close } = await startCallbackServer();

    try {
      // Prefer PRM resource scopes (e.g. api://icmmcpapi-prod/mcp.tools), add offline_access.
      // Fall back to auth server scopes_supported, then generic OIDC scopes.
      const scopes = buildScopes(prm.resourceScopes, metadata.scopes_supported);

      // When using the Copilot client ID, redirect through vscode.dev/redirect which
      // reads the state parameter to find the local callback URL and forwards the code.
      const redirectUri = useCopilotRedirect ? VSCODE_REDIRECT_URI : localRedirectUri;
      const state = useCopilotRedirect ? localRedirectUri : randomBytes(16).toString('hex');

      const authUrl = buildAuthorizationUrl(metadata.authorization_endpoint, {
        clientId,
        redirectUri,
        codeChallenge: challenge,
        scope: scopes,
        state,
      });

      onStatusChange?.('awaiting-consent');
      await shell.openExternal(authUrl);

      const code = await waitForCallback();

      onStatusChange?.('exchanging');
      const token = await exchangeCodeForToken(metadata.token_endpoint, {
        code,
        clientId,
        redirectUri,
        codeVerifier: verifier,
      });

      storeToken(serverUrl, token);
      return { success: true, token };
    } finally {
      close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Builds the OAuth scope string.
 * Priority: PRM resource scopes > auth server scopes > empty.
 * Always appends offline_access for refresh token support.
 */
function buildScopes(resourceScopes?: string[], authServerScopes?: string[]): string {
  const scopes = resourceScopes ?? authServerScopes ?? [];
  const set = new Set(scopes);
  set.add('offline_access');
  return [...set].join(' ');
}

/* ── Discovery ───────────────────────────────────────────────── */

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

/**
 * Tries to fetch a well-known metadata document from a base URL.
 * Attempts the RFC 9728 compliant path first (inserted after origin),
 * then falls back to the appended path (used by some servers).
 * Returns the parsed JSON or undefined if neither endpoint responds.
 */
async function fetchWellKnownMetadata(baseUrl: string, suffix: string): Promise<Record<string, unknown> | undefined> {
  const rfcUrl = buildWellKnownUrl(baseUrl, suffix);
  const fallbackUrl = buildWellKnownUrlFallback(baseUrl, suffix);
  const urls = rfcUrl === fallbackUrl ? [rfcUrl] : [rfcUrl, fallbackUrl];

  for (const url of urls) {
    try {
      console.log(`[aryx oauth] Trying well-known at ${url}…`);
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        const data = await response.json();
        console.log(`[aryx oauth] Found well-known metadata at ${url}`);
        return data;
      }
      console.log(`[aryx oauth] ${url} returned ${response.status}`);
    } catch {
      console.log(`[aryx oauth] ${url} unreachable`);
    }
  }

  return undefined;
}

interface PrmDiscoveryResult {
  authorizationServer: string;
  resourceScopes?: string[];
}

async function discoverProtectedResource(serverUrl: string): Promise<PrmDiscoveryResult> {
  const metadata = await fetchWellKnownMetadata(serverUrl, 'oauth-protected-resource');
  if (!metadata) {
    throw new Error('Protected Resource Metadata discovery failed: no well-known endpoint found');
  }

  const prm = metadata as unknown as ProtectedResourceMetadata;
  const authServer = prm.authorization_servers?.[0];
  if (!authServer) {
    throw new Error('No authorization server found in Protected Resource Metadata');
  }

  return { authorizationServer: authServer, resourceScopes: prm.scopes_supported };
}

async function fetchAuthServerMetadata(authServerUrl: string): Promise<AuthServerMetadata> {
  // RFC 8414 suffix first, then OpenID Connect Discovery suffix (used by Entra ID, Google, etc.)
  const metadata =
    (await fetchWellKnownMetadata(authServerUrl, 'oauth-authorization-server')) ??
    (await fetchWellKnownMetadata(authServerUrl, 'openid-configuration'));

  if (!metadata) {
    throw new Error('Authorization Server Metadata fetch failed: no well-known endpoint found');
  }

  const asMeta = metadata as unknown as AuthServerMetadata;
  if (!asMeta.authorization_endpoint || !asMeta.token_endpoint) {
    throw new Error('Authorization server metadata is missing required endpoints');
  }

  return asMeta;
}

/* ── Dynamic Client Registration (RFC 7591) ──────────────────── */

async function dynamicClientRegistration(metadata: AuthServerMetadata, serverUrl: string): Promise<string> {
  if (!metadata.registration_endpoint) {
    throw new Error(
      'No static client ID provided and the authorization server does not support dynamic client registration',
    );
  }

  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Aryx',
      redirect_uris: ['http://127.0.0.1/callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: metadata.scopes_supported?.join(' ') ?? '',
    }),
  });

  if (!response.ok) {
    throw new Error(`Dynamic client registration failed: ${response.status} ${response.statusText}`);
  }

  const registration = await response.json();
  if (!registration.client_id) {
    throw new Error('Dynamic client registration response is missing client_id');
  }

  return registration.client_id;
}

/* ── PKCE ────────────────────────────────────────────────────── */

function generatePkceChallenge(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/* ── Authorization URL ───────────────────────────────────────── */

function buildAuthorizationUrl(
  authorizationEndpoint: string,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    state: string;
  },
): string {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.scope) {
    url.searchParams.set('scope', params.scope);
  }
  url.searchParams.set('state', params.state);
  return url.toString();
}

/* ── Local callback server ───────────────────────────────────── */

interface CallbackServerHandle {
  port: number;
  redirectUri: string;
  waitForCallback: () => Promise<string>;
  close: () => void;
}

function startCallbackServer(): Promise<CallbackServerHandle> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackResolve: (code: string) => void;
    let callbackReject: (err: Error) => void;

    const callbackPromise = new Promise<string>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      // Ignore requests without code or error (e.g. favicon)
      if (!code && !error) {
        res.writeHead(404);
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (code) {
        res.end('<html><body><h2>Authentication successful</h2><p>You can close this tab.</p></body></html>');
        callbackResolve(code);
      } else {
        const msg = errorDescription ?? error ?? 'Unknown error';
        res.end(`<html><body><h2>Authentication failed</h2><p>${escapeHtml(msg)}</p></body></html>`);
        callbackReject(new Error(`OAuth callback error: ${msg}`));
      }
    });

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      settled = true;
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind callback server'));
        return;
      }

      resolve({
        port: addr.port,
        redirectUri: `http://127.0.0.1:${addr.port}/`,
        waitForCallback: () => callbackPromise,
        close: () => server.close(),
      });
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error('Callback server start timed out'));
      }
    }, 5_000);
  });
}

/* ── Token exchange ──────────────────────────────────────────── */

async function exchangeCodeForToken(
  tokenEndpoint: string,
  params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  },
): Promise<McpOAuthToken> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Token response is missing access_token');
  }

  const token: McpOAuthToken = {
    accessToken: data.access_token,
    tokenType: data.token_type ?? 'Bearer',
    scope: data.scope,
  };

  if (data.expires_in && typeof data.expires_in === 'number') {
    token.expiresAt = Date.now() + data.expires_in * 1_000;
  }

  if (data.refresh_token) {
    token.refreshToken = data.refresh_token;
  }

  return token;
}

/* ── Utilities ───────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
