import { useEffect, useState } from 'react';

/** Format a millisecond duration as a human-readable elapsed string. */
export function formatElapsedMs(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

/**
 * Returns a live-ticking elapsed-time string while `active` is true.
 *
 * When the timer is no longer active and `completedAt` is provided, the
 * duration is computed as `completedAt − startedAt` — giving an accurate
 * frozen value even when the session is reopened much later.  Without
 * `completedAt` the hook falls back to `Date.now() − startedAt` at the
 * moment `active` becomes false.
 */
export function useElapsedTimer(
  startedAt: string | undefined,
  active: boolean,
  completedAt?: string,
): string | undefined {
  const startMs = startedAt ? new Date(startedAt).getTime() : undefined;
  const endMs = completedAt ? new Date(completedAt).getTime() : undefined;

  const computeElapsed = (): string | undefined => {
    if (!startMs || Number.isNaN(startMs)) return undefined;
    if (!active && endMs && !Number.isNaN(endMs)) {
      return formatElapsedMs(endMs - startMs);
    }
    return formatElapsedMs(Date.now() - startMs);
  };

  const [elapsed, setElapsed] = useState<string | undefined>(computeElapsed);

  useEffect(() => {
    if (!startMs || Number.isNaN(startMs)) {
      setElapsed(undefined);
      return;
    }

    // Sync immediately
    setElapsed(computeElapsed());

    if (!active) return;

    const id = setInterval(() => setElapsed(formatElapsedMs(Date.now() - startMs)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMs, endMs, active]);

  return elapsed;
}
