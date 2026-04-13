import { ArrowRight, Trash2, X } from 'lucide-react';

interface QuickPromptActionsProps {
  onDiscard: () => void;
  onClose: () => void;
  onContinueInAryx: () => void;
}

export function QuickPromptActions({ onDiscard, onClose, onContinueInAryx }: QuickPromptActionsProps) {
  return (
    <div className="qp-actions-enter flex items-center gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
      {/* Discard — destructive, muted */}
      <button
        onClick={onDiscard}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] transition hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
        type="button"
        title="Delete this session"
      >
        <Trash2 className="size-3.5" />
        Discard
      </button>

      {/* Close — neutral, preserves session */}
      <button
        onClick={onClose}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
        type="button"
        title="Close and keep session"
      >
        <X className="size-3.5" />
        Close
      </button>

      <div className="flex-1" />

      {/* Continue in Aryx — primary action */}
      <button
        onClick={onContinueInAryx}
        className="brand-gradient-bg flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12px] font-semibold text-white shadow-md shadow-[var(--color-accent)]/15 transition hover:shadow-lg hover:shadow-[var(--color-accent)]/25"
        type="button"
      >
        Continue in Aryx
        <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}
