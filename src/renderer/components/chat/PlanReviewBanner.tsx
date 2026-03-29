import { useCallback } from 'react';
import { ClipboardList, X } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import type { PendingPlanReviewRecord } from '@shared/domain/planReview';

export function PlanReviewBanner({
  planReview,
  onDismiss,
}: {
  planReview: PendingPlanReviewRecord;
  onDismiss: (planReview: PendingPlanReviewRecord) => void;
}) {
  const handleDismiss = useCallback(() => {
    onDismiss(planReview);
  }, [planReview, onDismiss]);

  return (
    <div className="rounded-xl border border-[var(--color-glass-border)] border-l-4 border-l-[var(--color-status-success)] bg-[var(--color-glass)] px-4 py-3" role="alert">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <ClipboardList className="mt-0.5 size-4 shrink-0 text-[var(--color-status-success)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-status-success)]">Plan ready for review</span>
              <span className="rounded-full bg-[var(--color-status-success)]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-status-success)]">
                Plan mode
              </span>
            </div>
            <button
              aria-label="Dismiss plan"
              className="rounded p-0.5 text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)]/50 hover:text-[var(--color-text-primary)]"
              onClick={handleDismiss}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {planReview.agentName && (
            <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
              Agent: <span className="text-[var(--color-text-primary)]">{planReview.agentName}</span>
            </div>
          )}

          {/* Summary */}
          {planReview.summary && (
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
              {planReview.summary}
            </p>
          )}

          {/* Plan content (rendered markdown) */}
          {planReview.planContent && (
            <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-3">
              <MarkdownContent content={planReview.planContent} />
            </div>
          )}

          {/* Guidance */}
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            Send a follow-up message to proceed — e.g.{' '}
            <span className="text-[var(--color-text-primary)]">&quot;implement the plan&quot;</span>,{' '}
            <span className="text-[var(--color-text-primary)]">&quot;adjust step 3&quot;</span>, or ask for a different approach.
          </p>
        </div>
      </div>
    </div>
  );
}
