import { MessageSquare, Plus, Settings } from 'lucide-react';

interface WelcomePaneProps {
  hasProjects: boolean;
  onNewSession: () => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
}

export function WelcomePane({
  hasProjects,
  onNewSession,
  onAddProject,
  onOpenSettings,
}: WelcomePaneProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-indigo-600/10">
          <MessageSquare className="size-8 text-indigo-400" />
        </div>

        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Welcome to kopaya</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
            Orchestrate AI agents across your projects. Start a session to begin a conversation
            with one or more Copilot-backed agents.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          {hasProjects ? (
            <button
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500"
              onClick={onNewSession}
              type="button"
            >
              <Plus className="size-4" />
              New Session
            </button>
          ) : (
            <button
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500"
              onClick={onAddProject}
              type="button"
            >
              <Plus className="size-4" />
              Add Your First Project
            </button>
          )}
          <button
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
            onClick={onOpenSettings}
            type="button"
          >
            <Settings className="size-3.5" />
            Manage patterns
          </button>
        </div>
      </div>
    </div>
  );
}
