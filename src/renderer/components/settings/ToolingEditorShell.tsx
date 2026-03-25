import { AlertCircle, ChevronLeft, Trash } from 'lucide-react';
import type { ReactNode } from 'react';

export function ToolingEditorShell({
  title,
  subtitle,
  error,
  disableSave,
  onBack,
  onSave,
  onDelete,
  children,
}: {
  title: string;
  subtitle: string;
  error?: string;
  disableSave: boolean;
  onBack: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="drag-region flex items-center justify-between border-b border-[var(--color-border)] px-5 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <button
            className="no-drag flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onBack}
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div>
            <h2 className="text-[13px] font-semibold text-zinc-100">{title}</h2>
            <p className="text-[12px] text-zinc-500">{subtitle}</p>
          </div>
        </div>
        <div className="no-drag flex items-center gap-2">
          {onDelete && (
            <button
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-red-400 transition hover:bg-red-500/10"
              onClick={() => void onDelete()}
              type="button"
            >
              <Trash className="size-3.5" />
              Delete
            </button>
          )}
          <button
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disableSave}
            onClick={() => void onSave()}
            type="button"
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-8">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-300">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
