export type McpAuthStatus = 'pending' | 'authenticating' | 'authenticated' | 'failed';

export interface McpOauthStaticClientConfig {
  clientId: string;
  publicClient?: boolean;
}

export interface PendingMcpAuthRecord {
  id: string;
  status: McpAuthStatus;
  agentId?: string;
  agentName?: string;
  serverName: string;
  serverUrl: string;
  staticClientConfig?: McpOauthStaticClientConfig;
  requestedAt: string;
  completedAt?: string;
  errorMessage?: string;
}
