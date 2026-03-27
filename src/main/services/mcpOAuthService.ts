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

const VSCODE_REDIRECT_URI = 'https://vscode.dev/redirect';

interface KnownOAuthProvider {
  id: 'github' | 'entra';
  clientId: string;
  redirectMode: 'vscode-dev';
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  scopes?: readonly string[];
  authorizationParams?: Readonly<Record<string, string>>;
  includeOfflineAccess?: boolean;
}

interface KnownOAuthProviderConfig extends KnownOAuthProvider {
  matches: (url: URL) => boolean;
}

const GITHUB_PROVIDER_SCOPES = [
  'codespace',
  'gist',
  'notifications',
  'project',
  'read:org',
  'read:packages',
  'read:project',
  'read:user',
  'repo',
  'user:email',
  'workflow',
  'write:packages',
] as const;

const knownOAuthProviders: readonly KnownOAuthProviderConfig[] = [
  {
    id: 'github',
    clientId: '01ab8ac9400c4e429b23',
    redirectMode: 'vscode-dev',
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    scopes: GITHUB_PROVIDER_SCOPES,
    authorizationParams: { prompt: 'select_account' },
    includeOfflineAccess: false,
    matches: (url) => url.hostname === 'github.com',
  },
  {
    id: 'entra',
    clientId: 'aebc6443-996d-45c2-90f0-388ff96faa56',
    redirectMode: 'vscode-dev',
    includeOfflineAccess: true,
    matches: (url) => url.hostname === 'login.microsoftonline.com',
  },
] as const;

export function resolveKnownProvider(authServerUrl: string): KnownOAuthProvider | undefined {
  try {
    const parsed = new URL(authServerUrl);
    const match = knownOAuthProviders.find((candidate) => candidate.matches(parsed));
    if (!match) {
      return undefined;
    }

    const { matches: _matches, ...provider } = match;
    return provider;
  } catch {
    return undefined;
  }
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
    const knownProvider = resolveKnownProvider(prm.authorizationServer);
    const { verifier, challenge } = generatePkceChallenge();
    const {
      localRedirectUri,
      hostedRedirectState,
      waitForCallback,
      close,
    } = await startCallbackServer();

    try {
      const metadata = await resolveAuthServerMetadata(prm.authorizationServer, knownProvider);
      const clientId = staticClientConfig?.clientId
        ?? knownProvider?.clientId
        ?? await dynamicClientRegistration(metadata, localRedirectUri, serverUrl);
      const usesHostedRedirect = knownProvider?.redirectMode === 'vscode-dev';
      const scopes = buildScopes(knownProvider, prm.resourceScopes, metadata.scopes_supported);
      const redirectUri = usesHostedRedirect ? VSCODE_REDIRECT_URI : localRedirectUri;
      const state = usesHostedRedirect ? hostedRedirectState : randomBytes(16).toString('hex');

      const authUrl = buildAuthorizationUrl(metadata.authorization_endpoint, {
        clientId,
        redirectUri,
        codeChallenge: challenge,
        scope: scopes,
        state,
        extraParams: knownProvider?.authorizationParams,
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
 * Priority: provider-specific scopes > PRM resource scopes > auth server scopes.
 * `offline_access` is only appended when the provider supports/needs it.
 */
export function buildScopes(
  knownProvider: KnownOAuthProvider | undefined,
  resourceScopes?: string[],
  authServerScopes?: string[],
): string {
  const scopes = knownProvider?.scopes ?? resourceScopes ?? authServerScopes ?? [];
  if (scopes.length === 0) {
    return '';
  }

  const set = new Set(scopes);
  if (knownProvider?.includeOfflineAccess ?? true) {
    set.add('offline_access');
  }
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

async function resolveAuthServerMetadata(
  authServerUrl: string,
  knownProvider: KnownOAuthProvider | undefined,
): Promise<AuthServerMetadata> {
  if (knownProvider?.authorizationEndpoint && knownProvider?.tokenEndpoint) {
    return {
      issuer: authServerUrl,
      authorization_endpoint: knownProvider.authorizationEndpoint,
      token_endpoint: knownProvider.tokenEndpoint,
      scopes_supported: knownProvider.scopes ? [...knownProvider.scopes] : undefined,
    };
  }

  return fetchAuthServerMetadata(authServerUrl);
}

/* ── Dynamic Client Registration (RFC 7591) ──────────────────── */

async function dynamicClientRegistration(
  metadata: AuthServerMetadata,
  redirectUri: string,
  serverUrl: string,
): Promise<string> {
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
      redirect_uris: [redirectUri],
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
    extraParams?: Readonly<Record<string, string>>;
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
  for (const [key, value] of Object.entries(params.extraParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/* ── Local callback server ───────────────────────────────────── */

interface CallbackServerHandle {
  port: number;
  localRedirectUri: string;
  hostedRedirectState: string;
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
        localRedirectUri: `http://127.0.0.1:${addr.port}/callback`,
        hostedRedirectState: buildHostedRedirectState(`http://127.0.0.1:${addr.port}/callback`),
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

function buildHostedRedirectState(localRedirectUri: string): string {
  const stateUrl = new URL(localRedirectUri);
  stateUrl.searchParams.set('nonce', randomBytes(16).toString('base64url'));
  return stateUrl.toString();
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
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = parseTokenResponseBody(await response.text(), response.headers.get('content-type'));
  if (!response.ok) {
    const errorMessage =
      typeof data.error_description === 'string'
        ? data.error_description
        : typeof data.error === 'string'
          ? data.error
          : `${response.status} ${response.statusText}`;
    throw new Error(`Token exchange failed: ${errorMessage}`);
  }

  const accessToken = typeof data.access_token === 'string' ? data.access_token : undefined;
  const tokenType = typeof data.token_type === 'string' ? data.token_type : 'Bearer';
  const scope = typeof data.scope === 'string' ? data.scope : undefined;
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : undefined;

  if (!accessToken) {
    throw new Error('Token response is missing access_token');
  }

  const token: McpOAuthToken = {
    accessToken,
    tokenType,
    scope,
  };

  if (data.expires_in && typeof data.expires_in === 'number') {
    token.expiresAt = Date.now() + data.expires_in * 1_000;
  }

  if (refreshToken) {
    token.refreshToken = refreshToken;
  }

  return token;
}

export function parseTokenResponseBody(body: string, contentType?: string | null): Record<string, unknown> {
  const normalizedContentType = contentType?.toLowerCase() ?? '';
  if (normalizedContentType.includes('application/json') || body.trim().startsWith('{')) {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return {};
  }

  return Object.fromEntries(new URLSearchParams(body).entries());
}

/* ── Utilities ───────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
