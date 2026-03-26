import { useCallback } from 'react';
import { ClipboardList, Play, X } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import type { PendingPlanReviewRecord } from '@shared/domain/planReview';

export function PlanReviewBanner({
  planReview,
  onImplement,
  onDismiss,
}: {
  planReview: PendingPlanReviewRecord;
  onImplement: (planReview: PendingPlanReviewRecord) => void;
  onDismiss: (planReview: PendingPlanReviewRecord) => void;
}) {
  const handleImplement = useCallback(() => {
    onImplement(planReview);
  }, [planReview, onImplement]);

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
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-emerald-500"
          onClick={handleImplement}
          type="button"
        >
          <Play className="size-3" />
          Implement this plan
        </button>
        <button
          className="rounded-lg border border-zinc-600 px-3.5 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800 hover:text-white"
          onClick={handleDismiss}
          type="button"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
