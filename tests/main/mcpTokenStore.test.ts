import { describe, expect, test, beforeEach } from 'bun:test';

import {
  getStoredToken,
  storeToken,
  clearToken,
  clearAllTokens,
  type McpOAuthToken,
} from '@main/services/mcpTokenStore';

describe('MCP OAuth token store', () => {
  beforeEach(() => {
    clearAllTokens();
  });

  test('stores and retrieves tokens by server URL', () => {
    const token: McpOAuthToken = {
      accessToken: 'abc123',
      tokenType: 'Bearer',
    };

    storeToken('https://mcp.example.com/api', token);

    expect(getStoredToken('https://mcp.example.com/api')).toEqual(token);
  });

  test('normalizes trailing slashes and case in server URLs', () => {
    const token: McpOAuthToken = {
      accessToken: 'xyz',
      tokenType: 'Bearer',
    };

    storeToken('https://MCP.Example.com/api/', token);

    expect(getStoredToken('https://mcp.example.com/api')).toEqual(token);
    expect(getStoredToken('https://mcp.example.com/api/')).toEqual(token);
  });

  test('returns undefined for unknown server URLs', () => {
    expect(getStoredToken('https://unknown.example.com')).toBeUndefined();
  });

  test('clears a token for a specific server', () => {
    storeToken('https://a.example.com', { accessToken: 'a', tokenType: 'Bearer' });
    storeToken('https://b.example.com', { accessToken: 'b', tokenType: 'Bearer' });

    clearToken('https://a.example.com');

    expect(getStoredToken('https://a.example.com')).toBeUndefined();
    expect(getStoredToken('https://b.example.com')).toBeDefined();
  });

  test('clears all stored tokens', () => {
    storeToken('https://a.example.com', { accessToken: 'a', tokenType: 'Bearer' });
    storeToken('https://b.example.com', { accessToken: 'b', tokenType: 'Bearer' });

    clearAllTokens();

    expect(getStoredToken('https://a.example.com')).toBeUndefined();
    expect(getStoredToken('https://b.example.com')).toBeUndefined();
  });

  test('returns undefined for expired tokens', () => {
    const token: McpOAuthToken = {
      accessToken: 'expired',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1_000,
    };

    storeToken('https://mcp.example.com', token);

    expect(getStoredToken('https://mcp.example.com')).toBeUndefined();
  });

  test('returns valid tokens that have not expired', () => {
    const token: McpOAuthToken = {
      accessToken: 'valid',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000,
    };

    storeToken('https://mcp.example.com', token);

    expect(getStoredToken('https://mcp.example.com')).toEqual(token);
  });
});
