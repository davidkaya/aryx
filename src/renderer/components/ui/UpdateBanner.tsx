import { useState } from 'react';
import { ArrowDownToLine, Download, RefreshCw, Sparkles, X } from 'lucide-react';

import type { UpdateStatus } from '@shared/contracts/ipc';

export interface UpdateBannerProps {
  status: UpdateStatus;
  onViewDetails: () => void;
  onInstallUpdate: () => void;
}

export function UpdateBanner({ status, onViewDetails, onInstallUpdate }: UpdateBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const isActionable =
    status.state === 'available' ||
    status.state === 'downloading' ||
    status.state === 'downloaded';

  // Nothing to show
  if (!isActionable) return null;

  // Allow dismissal for transient states, never for downloaded
  if (dismissed && status.state !== 'downloaded') return null;

  const version = status.version ? `v${status.version}` : '';

  if (status.state === 'downloaded') {
    return (
      <div className="update-banner-enter px-3 pb-2" role="alert">
        <button
          className="group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl border border-[var(--color-status-success)]/25 bg-[var(--color-status-success)]/[0.07] px-3 py-2.5 text-left transition-all duration-200 hover:border-[var(--color-status-success)]/40 hover:bg-[var(--color-status-success)]/[0.12]"
          onClick={onInstallUpdate}
          type="button"
        >
          {/* Subtle glow effect */}
          <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: 'radial-gradient(ellipse at center, rgba(52, 211, 153, 0.08), transparent 70%)' }} />

          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-status-success)]/15">
            <Sparkles className="size-3.5 text-[var(--color-status-success)]" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-[var(--color-status-success)]">
              Update ready {version}
            </span>
            <span className="block text-[10px] text-[var(--color-text-muted)]">
              Restart to apply
            </span>
          </div>
          <span className="shrink-0 rounded-lg bg-[var(--color-status-success)]/15 px-2 py-1 text-[10px] font-semibold text-[var(--color-status-success)] transition-all duration-200 group-hover:bg-[var(--color-status-success)]/25">
            <RefreshCw className="inline-block size-3 mr-1 align-[-2px]" />
            Restart
          </span>
        </button>
      </div>
    );
  }

  // available / downloading
  const isDownloading = status.state === 'downloading';
  const percent = status.downloadProgress ? Math.round(status.downloadProgress.percent) : 0;

  return (
    <div className="update-banner-enter px-3 pb-2" role="status">
      <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/60">
        <button
          className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all duration-200 hover:bg-[var(--color-surface-2)]"
          onClick={onViewDetails}
          type="button"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)]/10">
            {isDownloading
              ? <Download className="size-3 text-[var(--color-accent)] animate-pulse" />
              : <ArrowDownToLine className="size-3 text-[var(--color-accent)]" />}
          </span>
          <div className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium text-[var(--color-text-primary)]">
              {isDownloading
                ? `Downloading ${version}${percent > 0 ? ` · ${percent}%` : '…'}`
                : `Update available ${version}`}
            </span>
          </div>
          <button
            className="flex size-5 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] opacity-0 transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            type="button"
            aria-label="Dismiss"
          >
            <X className="size-3" />
          </button>
        </button>

        {/* Download progress bar */}
        {isDownloading && percent > 0 && (
          <div className="h-[2px] w-full bg-[var(--color-surface-3)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
