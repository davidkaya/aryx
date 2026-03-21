import type { ReactNode } from 'react';

interface AppShellProps {
  sidebar: ReactNode;
  content: ReactNode;
}

export function AppShell({ sidebar, content }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-[360px] shrink-0 border-r border-slate-800 bg-slate-900/90">{sidebar}</aside>
      <main className="min-w-0 flex-1">{content}</main>
    </div>
  );
}
