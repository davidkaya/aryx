import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

import { shell } from 'electron';

import type { McpOauthStaticClientConfig } from '@shared/domain/mcpAuth';

import { storeToken, buildWellKnownUrl, type McpOAuthToken } from './mcpTokenStore';

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
    const prmUrl = buildWellKnownUrl(serverUrl, 'oauth-protected-resource');
    console.log(`[aryx oauth] Checking PRM at ${prmUrl}…`);
    const prmResponse = await fetch(prmUrl, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!prmResponse.ok) {
      console.log(`[aryx oauth] PRM returned ${prmResponse.status} — no OAuth needed`);
      return false;
    }

    const metadata = await prmResponse.json();
    const hasAuthServers = Array.isArray(metadata?.authorization_servers) && metadata.authorization_servers.length > 0;
    console.log(`[aryx oauth] PRM found: authorization_servers=${hasAuthServers}`);
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

    const authServerUrl = await discoverAuthorizationServer(serverUrl);
    const metadata = await fetchAuthServerMetadata(authServerUrl);

    const clientId = staticClientConfig?.clientId
      ?? await dynamicClientRegistration(metadata, serverUrl);

    const { verifier, challenge } = generatePkceChallenge();
    const { port, redirectUri, waitForCallback, close } = await startCallbackServer();

    try {
      const scopes = metadata.scopes_supported?.join(' ') ?? '';
      const authUrl = buildAuthorizationUrl(metadata.authorization_endpoint, {
        clientId,
        redirectUri,
        codeChallenge: challenge,
        scope: scopes,
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

/* ── Discovery ───────────────────────────────────────────────── */

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers?: string[];
}

interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

async function discoverAuthorizationServer(serverUrl: string): Promise<string> {
  const prmUrl = buildWellKnownUrl(serverUrl, 'oauth-protected-resource');

  const response = await fetch(prmUrl);
  if (!response.ok) {
    throw new Error(`Protected Resource Metadata discovery failed: ${response.status} ${response.statusText}`);
  }

  const metadata: ProtectedResourceMetadata = await response.json();
  const authServer = metadata.authorization_servers?.[0];
  if (!authServer) {
    throw new Error('No authorization server found in Protected Resource Metadata');
  }

  return authServer;
}

async function fetchAuthServerMetadata(authServerUrl: string): Promise<AuthServerMetadata> {
  const metadataUrl = buildWellKnownUrl(authServerUrl, 'oauth-authorization-server');

  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(`Authorization Server Metadata fetch failed: ${response.status} ${response.statusText}`);
  }

  const metadata: AuthServerMetadata = await response.json();
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error('Authorization server metadata is missing required endpoints');
  }

  return metadata;
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
  url.searchParams.set('state', randomBytes(16).toString('hex'));
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
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

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
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
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
