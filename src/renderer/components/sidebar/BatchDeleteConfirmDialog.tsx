import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { SessionRecord } from '@shared/domain/session';

interface BatchDeleteConfirmDialogProps {
  sessions: SessionRecord[];
  onConfirm: () => void;
  onCancel: () => void;
}

const HOLD_DURATION_MS = 1500;
const HOLD_THRESHOLD = 3;

export function BatchDeleteConfirmDialog({
  sessions,
  onConfirm,
  onCancel,
}: BatchDeleteConfirmDialogProps) {
  const requiresHold = sessions.length >= HOLD_THRESHOLD;
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first?.focus();

    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (!first || !last) return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    }

    document.addEventListener('keydown', handleTab);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleTab);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onCancel]);

  const startHold = useCallback(() => {
    if (!requiresHold) return;
    holdStartRef.current = performance.now();

    const tick = () => {
      if (!holdStartRef.current) return;
      const elapsed = performance.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        onConfirm();
        return;
      }
      holdTimerRef.current = requestAnimationFrame(tick);
    };
    holdTimerRef.current = requestAnimationFrame(tick);
  }, [requiresHold, onConfirm]);

  const cancelHold = useCallback(() => {
    holdStartRef.current = null;
    if (holdTimerRef.current !== null) {
      cancelAnimationFrame(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) cancelAnimationFrame(holdTimerRef.current);
    };
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className="overlay-backdrop-enter fixed inset-0 z-50 bg-black/60"
        onClick={onCancel}
        aria-hidden
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          ref={dialogRef}
          className="overlay-panel-enter w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="batch-delete-title"
          aria-describedby="batch-delete-desc"
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--color-status-error)]/10">
                <Trash2 className="size-5 text-[var(--color-status-error)]" />
              </div>
              <div>
                <h2
                  id="batch-delete-title"
                  className="text-[15px] font-semibold text-[var(--color-text-primary)]"
                >
                  Delete {sessions.length} session{sessions.length === 1 ? '' : 's'}?
                </h2>
              </div>
            </div>
            <button
              className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
              onClick={onCancel}
              type="button"
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Session list */}
          <div className="px-5">
            <div className="max-h-[200px] overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/60 px-3 py-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="truncate py-1 text-[12px] text-[var(--color-text-secondary)]"
                >
                  {session.title}
                </div>
              ))}
            </div>
          </div>

          {/* Warning */}
          <div className="px-5 pt-3" id="batch-delete-desc">
            <div className="flex items-start gap-2 rounded-lg bg-[var(--color-status-error)]/5 px-3 py-2 text-[12px] text-[var(--color-status-error)]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>This action cannot be undone. All messages and session data will be permanently removed.</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 p-5">
            <button
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            {requiresHold ? (
              <button
                className="hold-to-confirm relative overflow-hidden rounded-lg bg-[var(--color-status-error)] px-4 py-2 text-[13px] font-medium text-white transition-all select-none"
                onMouseDown={startHold}
                onMouseUp={cancelHold}
                onMouseLeave={cancelHold}
                onTouchStart={startHold}
                onTouchEnd={cancelHold}
                type="button"
              >
                {/* Progress fill */}
                <span
                  className="absolute inset-0 origin-left bg-white/20 transition-none"
                  style={{ transform: `scaleX(${holdProgress})` }}
                  aria-hidden
                />
                <span className="relative flex items-center gap-1.5">
                  <Trash2 className="size-3.5" />
                  {holdProgress > 0 ? 'Hold to delete…' : 'Hold to delete'}
                </span>
              </button>
            ) : (
              <button
                className="rounded-lg bg-[var(--color-status-error)] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[var(--color-status-error)]/80"
                onClick={onConfirm}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <Trash2 className="size-3.5" />
                  Delete
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
