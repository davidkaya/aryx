import { describe, expect, test } from 'bun:test';

import { buildWellKnownUrl, buildWellKnownUrlFallback, buildWellKnownUrlOriginOnly } from '@main/services/mcpTokenStore';

describe('buildWellKnownUrl', () => {
  test('inserts well-known segment after origin for URL with path', () => {
    expect(buildWellKnownUrl('https://api.githubcopilot.com/mcp/', 'oauth-protected-resource'))
      .toBe('https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/');
  });

  test('inserts well-known segment for URL with multi-level path', () => {
    expect(buildWellKnownUrl('https://example.com/v1/mcp/api', 'oauth-protected-resource'))
      .toBe('https://example.com/.well-known/oauth-protected-resource/v1/mcp/api');
  });

  test('handles origin-only URL without path', () => {
    expect(buildWellKnownUrl('https://auth.example.com', 'oauth-authorization-server'))
      .toBe('https://auth.example.com/.well-known/oauth-authorization-server');
  });

  test('handles origin-only URL with trailing slash', () => {
    expect(buildWellKnownUrl('https://auth.example.com/', 'oauth-authorization-server'))
      .toBe('https://auth.example.com/.well-known/oauth-authorization-server');
  });

  test('handles URL with port', () => {
    expect(buildWellKnownUrl('https://mcp.example.com:8443/v1/', 'oauth-protected-resource'))
      .toBe('https://mcp.example.com:8443/.well-known/oauth-protected-resource/v1/');
  });

  test('preserves path without trailing slash', () => {
    expect(buildWellKnownUrl('https://example.com/mcp', 'oauth-protected-resource'))
      .toBe('https://example.com/.well-known/oauth-protected-resource/mcp');
  });
});

describe('buildWellKnownUrlFallback', () => {
  test('appends well-known segment to the full URL path', () => {
    expect(buildWellKnownUrlFallback('https://icm-mcp-prod.azure-api.net/v1/', 'oauth-protected-resource'))
      .toBe('https://icm-mcp-prod.azure-api.net/v1/.well-known/oauth-protected-resource');
  });

  test('handles URL without trailing slash', () => {
    expect(buildWellKnownUrlFallback('https://example.com/mcp', 'oauth-protected-resource'))
      .toBe('https://example.com/mcp/.well-known/oauth-protected-resource');
  });

  test('handles origin-only URL', () => {
    expect(buildWellKnownUrlFallback('https://auth.example.com/', 'oauth-authorization-server'))
      .toBe('https://auth.example.com/.well-known/oauth-authorization-server');
  });
});

describe('buildWellKnownUrlOriginOnly', () => {
  test('strips path and returns origin-only well-known URL', () => {
    expect(buildWellKnownUrlOriginOnly('https://eschat.microsoft.com/mcp', 'oauth-protected-resource'))
      .toBe('https://eschat.microsoft.com/.well-known/oauth-protected-resource');
  });

  test('handles multi-level path', () => {
    expect(buildWellKnownUrlOriginOnly('https://example.com/v1/mcp/api', 'oauth-protected-resource'))
      .toBe('https://example.com/.well-known/oauth-protected-resource');
  });

  test('matches RFC URL when base has no path', () => {
    expect(buildWellKnownUrlOriginOnly('https://auth.example.com/', 'oauth-authorization-server'))
      .toBe('https://auth.example.com/.well-known/oauth-authorization-server');
  });

  test('handles URL with port', () => {
    expect(buildWellKnownUrlOriginOnly('https://mcp.example.com:8443/v1/', 'oauth-protected-resource'))
      .toBe('https://mcp.example.com:8443/.well-known/oauth-protected-resource');
  });
});
