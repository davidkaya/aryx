import type { ReactNode } from 'react';

interface AppShellProps {
  sidebar: ReactNode;
  content: ReactNode;
  detailPanel?: ReactNode;
  bottomPanel?: ReactNode;
  overlay?: ReactNode;
}

export function AppShell({ sidebar, content, detailPanel, bottomPanel, overlay }: AppShellProps) {
  return (
    <div className="relative flex h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]">
      {/* Full-width drag region matching the title bar overlay height */}
      <div className="drag-region absolute inset-x-0 top-0 z-10 h-3" />

      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
        {sidebar}
      </aside>

      {/* Main content + bottom panel */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Ambient glow behind active content area */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ background: 'var(--gradient-glow)' }}
        />
        <div className="relative min-h-0 flex-1">{content}</div>
        {bottomPanel}
      </main>

      {/* Detail panel */}
      {detailPanel && (
        <aside className="flex w-64 shrink-0 flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
          {detailPanel}
        </aside>
      )}

      {overlay}
    </div>
  );
}
