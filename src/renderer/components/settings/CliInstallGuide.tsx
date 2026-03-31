import { useState, useCallback } from 'react';
import { Check, Copy, ChevronRight, KeyRound, Sparkles } from 'lucide-react';

import { detectedPlatform, type DetectedPlatform } from '@renderer/lib/platform';
import {
  installInstructions,
  authCommand,
  type PlatformInstallInfo,
  type InstallMethod,
} from '@renderer/lib/cliInstallInstructions';

interface CliInstallGuideProps {
  onRefresh: () => void;
  isRefreshing: boolean;
}

function PlatformTab({
  info,
  active,
  onClick,
}: {
  info: PlatformInstallInfo;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-all duration-200 ${
        active
          ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)] shadow-sm'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
      }`}
      aria-pressed={active}
    >
      {info.displayName}
    </button>
  );
}

function CommandBlock({
  method,
  index,
}: {
  method: InstallMethod;
  index: number;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(method.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [method.command]);

  return (
    <div
      className="group/cmd space-y-1.5"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Method label row */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
          {method.label}
        </span>
        {method.recommended && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--color-accent)]">
            <Sparkles className="size-2.5" />
            Recommended
          </span>
        )}
      </div>

      {/* Command block */}
      <div className="relative flex items-center overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
          <ChevronRight className="size-3 shrink-0 text-[var(--color-accent)]/60" />
          <code className="min-w-0 select-all truncate font-mono text-[12px] leading-relaxed text-[var(--color-text-primary)]">
            {method.command}
          </code>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex shrink-0 items-center gap-1 border-l border-[var(--color-border-subtle)] px-2.5 py-2 text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
          title="Copy command"
          aria-label={`Copy command: ${method.command}`}
        >
          {copied ? (
            <Check className="size-3 text-[var(--color-status-success)]" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
      </div>
    </div>
  );
}

export function CliInstallGuide({ onRefresh, isRefreshing }: CliInstallGuideProps) {
  const [activePlatform, setActivePlatform] = useState<DetectedPlatform>(detectedPlatform);

  const activeInfo = installInstructions.find((i) => i.platform === activePlatform)!;

  return (
    <div className="space-y-4">
      {/* Step 1: Install */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[10px] font-bold text-[var(--color-accent)]">
            1
          </span>
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
            Install the Copilot CLI
          </span>
        </div>

        {/* Platform tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
          {installInstructions.map((info) => (
            <PlatformTab
              key={info.platform}
              active={activePlatform === info.platform}
              info={info}
              onClick={() => setActivePlatform(info.platform)}
            />
          ))}
        </div>

        {/* Commands for active platform */}
        <div className="space-y-3">
          {activeInfo.methods.map((method, i) => (
            <CommandBlock key={method.label} index={i} method={method} />
          ))}
        </div>
      </div>

      {/* Step 2: Authenticate */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[10px] font-bold text-[var(--color-accent)]">
            2
          </span>
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
            Sign in to GitHub
          </span>
        </div>

        <AuthCommandBlock />
      </div>

      {/* Step 3: Refresh */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[10px] font-bold text-[var(--color-accent)]">
            3
          </span>
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
            Refresh connection
          </span>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/8 px-3 py-2 text-[12px] font-medium text-[var(--color-accent)] transition-all duration-200 hover:bg-[var(--color-accent)]/15 disabled:opacity-50"
        >
          {isRefreshing ? 'Checking…' : 'Check connection'}
        </button>
      </div>
    </div>
  );
}

function AuthCommandBlock() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(authCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, []);

  return (
    <div className="relative flex items-center overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
        <KeyRound className="size-3 shrink-0 text-[var(--color-accent)]/60" />
        <code className="min-w-0 select-all truncate font-mono text-[12px] leading-relaxed text-[var(--color-text-primary)]">
          {authCommand}
        </code>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="flex shrink-0 items-center gap-1 border-l border-[var(--color-border-subtle)] px-2.5 py-2 text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
        title="Copy command"
        aria-label="Copy authentication command"
      >
        {copied ? (
          <Check className="size-3 text-[var(--color-status-success)]" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
    </div>
  );
}
