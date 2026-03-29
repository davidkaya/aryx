import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

export function InfoCallout({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-glass)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--color-text-secondary)] backdrop-blur-sm">
      <Info className="mt-0.5 size-3.5 shrink-0 text-[var(--color-accent)]" />
      <span>{children}</span>
    </div>
  );
}
