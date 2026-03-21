import type { ReactNode } from 'react';

interface AppShellProps {
  sidebar: ReactNode;
  content: ReactNode;
  overlay?: ReactNode;
}

export function AppShell({ sidebar, content, overlay }: AppShellProps) {
  return (
    <div className="relative flex h-screen bg-[var(--color-surface-0)] text-zinc-100">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-1)]">
        {sidebar}
      </aside>
      <main className="relative min-w-0 flex-1">{content}</main>
      {overlay}
    </div>
  );
}
