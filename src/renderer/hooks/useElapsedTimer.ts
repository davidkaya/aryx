import { useEffect, useState } from 'react';

function formatElapsed(startMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

/**
 * Returns a live-ticking elapsed-time string while `active` is true.
 * Freezes the display when `active` becomes false.
 */
export function useElapsedTimer(startedAt: string | undefined, active: boolean): string | undefined {
  const startMs = startedAt ? new Date(startedAt).getTime() : undefined;

  const [elapsed, setElapsed] = useState<string | undefined>(() => {
    if (!startMs) return undefined;
    return formatElapsed(startMs);
  });

  useEffect(() => {
    if (!startMs) {
      setElapsed(undefined);
      return;
    }

    // Always sync to current value immediately
    setElapsed(formatElapsed(startMs));

    if (!active) return;

    const id = setInterval(() => setElapsed(formatElapsed(startMs)), 1000);
    return () => clearInterval(id);
  }, [startMs, active]);

  return elapsed;
}
