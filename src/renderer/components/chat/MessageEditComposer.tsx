import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

export interface MessageEditComposerProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

export function MessageEditComposer({ initialContent, onSave, onCancel }: MessageEditComposerProps) {
  const [content, setContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    resizeTextarea(ta);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const trimmed = content.trim();
        if (trimmed) onSave(trimmed);
      }
    },
    [content, onCancel, onSave],
  );

  function resizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }

  const canSave = content.trim().length > 0 && content.trim() !== initialContent.trim();

  return (
    <div className="msg-actions-enter">
      <textarea
        ref={textareaRef}
        className="w-full resize-none rounded-lg border border-[var(--color-border-glow)] bg-[var(--color-surface-0)] px-3 py-2 text-[14px] leading-relaxed text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent)]/50"
        onChange={(e) => {
          setContent(e.target.value);
          resizeTextarea(e.target);
        }}
        onKeyDown={handleKeyDown}
        rows={1}
        value={content}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-all duration-150 hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canSave}
          onClick={() => onSave(content.trim())}
          type="button"
        >
          <Check className="size-3" />
          Save &amp; Resend
        </button>
        <button
          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-all duration-150 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
          onClick={onCancel}
          type="button"
        >
          <X className="size-3" />
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          Ctrl+Enter to save · Esc to cancel
        </span>
      </div>
    </div>
  );
}
