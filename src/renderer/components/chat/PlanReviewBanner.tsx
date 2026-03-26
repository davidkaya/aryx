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
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3" role="alert">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <ClipboardList className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-emerald-200">Plan ready for review</span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
                Plan mode
              </span>
            </div>
            <button
              aria-label="Dismiss plan"
              className="rounded p-0.5 text-zinc-500 transition hover:bg-zinc-700/50 hover:text-zinc-300"
              onClick={handleDismiss}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {planReview.agentName && (
            <div className="mt-1 text-[11px] text-zinc-400">
              Agent: <span className="text-zinc-300">{planReview.agentName}</span>
            </div>
          )}

          {/* Summary */}
          {planReview.summary && (
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-200">
              {planReview.summary}
            </p>
          )}

          {/* Plan content (rendered markdown) */}
          {planReview.planContent && (
            <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-zinc-700/50 bg-zinc-900/60 p-3">
              <MarkdownContent content={planReview.planContent} />
            </div>
          )}

          {/* Guidance */}
          <p className="mt-3 text-[12px] leading-relaxed text-zinc-400">
            Send a follow-up message to proceed — e.g.{' '}
            <span className="text-zinc-300">&quot;implement the plan&quot;</span>,{' '}
            <span className="text-zinc-300">&quot;adjust step 3&quot;</span>, or ask for a different approach.
          </p>
        </div>
      </div>
    </div>
  );
}
