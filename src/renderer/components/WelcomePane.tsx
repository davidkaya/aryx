import { MessageSquare, Plus, Settings } from 'lucide-react';

interface WelcomePaneProps {
  hasProjects: boolean;
  onNewScratchpad: () => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
}

export function WelcomePane({
  hasProjects,
  onNewScratchpad,
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
          <h1 className="text-base font-semibold text-zinc-100">Welcome to eryx</h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-zinc-500">
            Start a scratchpad conversation for ad-hoc questions or connect a project to work with
            repo-aware Copilot agents.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-indigo-500"
            onClick={onNewScratchpad}
            type="button"
          >
            <Plus className="size-4" />
            New Scratchpad
          </button>
          {!hasProjects && (
            <button
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
              onClick={onAddProject}
              type="button"
            >
              <Plus className="size-3.5" />
              Add Your First Project
            </button>
          )}
          <button
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
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
