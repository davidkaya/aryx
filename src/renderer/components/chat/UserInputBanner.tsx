import { useState, useCallback } from 'react';
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';

import type { PendingUserInputRecord } from '@shared/domain/userInput';

export function UserInputBanner({
  userInput,
  onSubmit,
  isSubmitting,
}: {
  userInput: PendingUserInputRecord;
  onSubmit: (answer: string, wasFreeform: boolean) => void;
  isSubmitting: boolean;
}) {
  const [freeformText, setFreeformText] = useState('');
  const hasChoices = userInput.choices && userInput.choices.length > 0;

  const handleChoiceClick = useCallback(
    (choice: string) => {
      if (!isSubmitting) {
        onSubmit(choice, false);
      }
    },
    [isSubmitting, onSubmit],
  );

  const handleFreeformSubmit = useCallback(() => {
    const trimmed = freeformText.trim();
    if (trimmed && !isSubmitting) {
      onSubmit(trimmed, true);
    }
  }, [freeformText, isSubmitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleFreeformSubmit();
      }
    },
    [handleFreeformSubmit],
  );

  return (
    <div className="rounded-xl border border-[var(--color-glass-border)] border-l-4 border-l-[var(--color-accent-sky)] bg-[var(--color-glass)] px-4 py-3" role="alert">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-[var(--color-accent-sky)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--color-accent-sky)]">Agent question</span>
            <span className="rounded-full bg-[var(--color-accent-sky)]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-accent-sky)]">
              User input
            </span>
          </div>

          {userInput.agentName && (
            <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
              Agent: <span className="text-[var(--color-text-primary)]">{userInput.agentName}</span>
            </div>
          )}

          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap">
            {userInput.question}
          </p>
        </div>
      </div>

      {/* Choices */}
      {hasChoices && (
        <div className="mt-3 flex flex-wrap gap-2">
          {userInput.choices!.map((choice) => (
            <button
              className="rounded-lg border border-[var(--color-accent-sky)]/30 bg-[var(--color-accent-sky)]/10 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-accent-sky)] transition-all duration-200 hover:border-[var(--color-accent-sky)]/50 hover:bg-[var(--color-accent-sky)]/20 hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSubmitting}
              key={choice}
              onClick={() => handleChoiceClick(choice)}
              type="button"
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {/* Freeform input */}
      {userInput.allowFreeform && (
        <div className="mt-3 flex items-center gap-2">
          <input
            aria-label="Type your answer"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition-all duration-200 focus:border-[var(--color-border-glow)] focus:ring-1 focus:ring-[var(--color-border-glow)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            onChange={(e) => setFreeformText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasChoices ? 'Or type your own answer…' : 'Type your answer…'}
            type="text"
            value={freeformText}
          />
          <button
            aria-label="Submit answer"
            className="brand-gradient-bg inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-white transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting || !freeformText.trim()}
            onClick={handleFreeformSubmit}
            type="button"
          >
            {isSubmitting ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
            Send
          </button>
        </div>
      )}
    </div>
  );
}
