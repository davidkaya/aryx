import type { ReactNode } from 'react';

interface AppShellProps {
  sidebar: ReactNode;
  content: ReactNode;
  detailPanel?: ReactNode;
  overlay?: ReactNode;
}

export function AppShell({ sidebar, content, detailPanel, overlay }: AppShellProps) {
  return (
    <div className="relative flex h-screen bg-[var(--color-surface-0)] text-zinc-100">
      {/* Full-width drag region matching the title bar overlay height */}
      <div className="drag-region absolute inset-x-0 top-0 z-10 h-3" />

      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-1)]">
        {sidebar}
      </aside>
      <main className="relative min-w-0 flex-1">{content}</main>
      {detailPanel && (
        <aside className="flex w-64 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface-1)]">
          {detailPanel}
        </aside>
      )}
      {overlay}
    </div>
  );
}
