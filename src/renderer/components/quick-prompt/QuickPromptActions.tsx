import { ArrowRight, Trash2, X } from 'lucide-react';

interface QuickPromptActionsProps {
  onDiscard: () => void;
  onClose: () => void;
  onContinueInAryx: () => void;
}

export function QuickPromptActions({ onDiscard, onClose, onContinueInAryx }: QuickPromptActionsProps) {
  return (
    <div className="qp-actions-enter flex items-center gap-1.5 border-t border-[var(--color-border-subtle)]/60 px-4 py-2.5">
      <button
        onClick={onDiscard}
        className="flex items-center gap-1.5 rounded-lg px-3 py-[6px] text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-status-error)]/8 hover:text-[var(--color-status-error)]"
        type="button"
        title="Delete this session permanently"
      >
        <Trash2 className="size-3" />
        Discard
      </button>

      <button
        onClick={onClose}
        className="flex items-center gap-1.5 rounded-lg px-3 py-[6px] text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
        type="button"
        title="Close and keep session for later"
      >
        <X className="size-3" />
        Close
      </button>

      <div className="flex-1" />

      <button
        onClick={onContinueInAryx}
        className="brand-gradient-bg flex items-center gap-1.5 rounded-lg px-4 py-[6px] text-[11px] font-semibold text-white shadow-sm shadow-[var(--color-accent)]/15 transition-all hover:shadow-md hover:shadow-[var(--color-accent)]/25 hover:brightness-110"
        type="button"
      >
        Continue in Aryx
        <ArrowRight className="size-3" />
      </button>
    </div>
  );
}
