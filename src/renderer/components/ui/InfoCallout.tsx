import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

export function InfoCallout({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-500">
      <Info className="mt-0.5 size-3.5 shrink-0 text-zinc-600" />
      <span>{children}</span>
    </div>
  );
}
