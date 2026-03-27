import { describe, expect, mock, test } from 'bun:test';

mock.module('electron', () => {
  const electronMock = {
    shell: {
      openExternal: async () => undefined,
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

const {
  buildScopes,
  parseTokenResponseBody,
  resolveKnownProvider,
} = await import('@main/services/mcpOAuthService');

describe('resolveKnownProvider', () => {
  test('matches GitHub OAuth provider', () => {
    const provider = resolveKnownProvider('https://github.com/login/oauth');

    expect(provider?.id).toBe('github');
    expect(provider?.clientId).toBe('01ab8ac9400c4e429b23');
    expect(provider?.authorizationEndpoint).toBe('https://github.com/login/oauth/authorize');
    expect(provider?.tokenEndpoint).toBe('https://github.com/login/oauth/access_token');
    expect(provider?.authorizationParams).toEqual({ prompt: 'select_account' });
  });

  test('matches Entra OAuth provider', () => {
    const provider = resolveKnownProvider('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0');

    expect(provider?.id).toBe('entra');
    expect(provider?.clientId).toBe('aebc6443-996d-45c2-90f0-388ff96faa56');
    expect(provider?.authorizationEndpoint).toBeUndefined();
    expect(provider?.tokenEndpoint).toBeUndefined();
  });

  test('returns undefined for unknown provider', () => {
    expect(resolveKnownProvider('https://auth.example.com')).toBeUndefined();
  });
});

describe('buildScopes', () => {
  test('uses provider-specific GitHub scopes without offline access', () => {
    const provider = resolveKnownProvider('https://github.com/login/oauth');

    expect(buildScopes(provider, ['ignored'], ['also-ignored']))
      .toBe('codespace gist notifications project read:org read:packages read:project read:user repo user:email workflow write:packages');
  });

  test('uses protected resource scopes for Entra and appends offline access', () => {
    const provider = resolveKnownProvider('https://login.microsoftonline.com/common/v2.0');

    expect(buildScopes(provider, ['api://icmmcpapi-prod/mcp.tools'], ['openid']))
      .toBe('api://icmmcpapi-prod/mcp.tools offline_access');
  });

  test('falls back to auth server scopes for unknown providers', () => {
    expect(buildScopes(undefined, undefined, ['openid', 'profile']))
      .toBe('openid profile offline_access');
  });
});

describe('parseTokenResponseBody', () => {
  test('parses JSON token responses', () => {
    expect(parseTokenResponseBody('{"access_token":"abc","token_type":"Bearer"}', 'application/json'))
      .toEqual({ access_token: 'abc', token_type: 'Bearer' });
  });

  test('parses form-encoded token responses', () => {
    expect(parseTokenResponseBody('access_token=abc&scope=repo%20user%3Aemail&token_type=bearer', 'application/x-www-form-urlencoded'))
      .toEqual({ access_token: 'abc', scope: 'repo user:email', token_type: 'bearer' });
  });
});
