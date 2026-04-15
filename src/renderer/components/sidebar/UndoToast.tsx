import { useEffect, useRef, useState } from 'react';
import { Undo2, X } from 'lucide-react';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  duration?: number;
}

export function UndoToast({
  message,
  onUndo,
  onDismiss,
  duration = 5000,
}: UndoToastProps) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(onDismiss, 200);
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [duration, onDismiss]);

  function handleUndo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    onUndo();
  }

  function handleDismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(onDismiss, 200);
  }

  return (
    <div
      className={`${exiting ? 'undo-toast-exit' : 'undo-toast-enter'} pointer-events-auto mx-3 mb-2 flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]/95 px-3 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-md`}
      role="alert"
    >
      <span className="flex-1 text-[12px] text-[var(--color-text-primary)]">
        {message}
      </span>
      <button
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10"
        onClick={handleUndo}
        type="button"
      >
        <Undo2 className="size-3" />
        Undo
      </button>
      <button
        className="flex size-5 items-center justify-center rounded text-[var(--color-text-muted)] transition hover:text-[var(--color-text-primary)]"
        onClick={handleDismiss}
        type="button"
        aria-label="Dismiss"
      >
        <X className="size-3" />
      </button>

      {/* Auto-dismiss progress bar */}
      <span
        className="absolute bottom-0 left-0 right-0 h-[2px] origin-left rounded-b-xl bg-[var(--color-accent)]/30"
        style={{
          animation: `toast-progress ${duration}ms linear forwards`,
        }}
        aria-hidden
      />
    </div>
  );
}
