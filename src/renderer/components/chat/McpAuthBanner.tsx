import { useCallback } from 'react';
import { KeyRound, Loader2, X } from 'lucide-react';

import type { PendingMcpAuthRecord } from '@shared/domain/mcpAuth';

export function McpAuthBanner({
  mcpAuth,
  onAuthenticate,
  onDismiss,
}: {
  mcpAuth: PendingMcpAuthRecord;
  onAuthenticate: () => void;
  onDismiss: () => void;
}) {
  const handleAuthenticate = useCallback(() => {
    onAuthenticate();
  }, [onAuthenticate]);

  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  const isAuthenticating = mcpAuth.status === 'authenticating';
  const hasFailed = mcpAuth.status === 'failed';

  return (
    <div className="rounded-xl border border-[var(--color-glass-border)] border-l-4 border-l-[var(--color-status-warning)] bg-[var(--color-glass)] px-4 py-3" role="alert">
      <div className="flex items-start gap-2.5">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--color-status-warning)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-status-warning)]">Authentication required</span>
              <span className="rounded-full bg-[var(--color-status-warning)]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-status-warning)]">
                MCP
              </span>
            </div>
            <button
              aria-label="Dismiss authentication prompt"
              className="rounded p-0.5 text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)]/50 hover:text-[var(--color-text-primary)]"
              onClick={handleDismiss}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
            The MCP server{' '}
            <span className="font-medium text-[var(--color-status-warning)]">{mcpAuth.serverName}</span>{' '}
            requires OAuth authentication to connect.
          </p>

          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{mcpAuth.serverUrl}</p>

          {hasFailed && mcpAuth.errorMessage && (
            <p className="mt-2 text-[12px] text-[var(--color-status-error)]">{mcpAuth.errorMessage}</p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              className="brand-gradient-bg inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white transition-all duration-200 hover:brightness-110 disabled:opacity-50"
              disabled={isAuthenticating}
              onClick={handleAuthenticate}
              type="button"
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Authenticating…
                </>
              ) : hasFailed ? (
                'Retry authentication'
              ) : (
                'Authenticate in browser'
              )}
            </button>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {isAuthenticating
                ? 'Waiting for consent in the browser…'
                : 'Opens your browser for OAuth consent. Token is stored for this session only.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
