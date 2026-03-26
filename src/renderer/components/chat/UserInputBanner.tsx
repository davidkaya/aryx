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
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-4 py-3" role="alert">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-blue-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-blue-200">Agent question</span>
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-400">
              User input
            </span>
          </div>

          {userInput.agentName && (
            <div className="mt-1 text-[11px] text-zinc-400">
              Agent: <span className="text-zinc-300">{userInput.agentName}</span>
            </div>
          )}

          <p className="mt-2 text-[13px] leading-relaxed text-zinc-200 whitespace-pre-wrap">
            {userInput.question}
          </p>
        </div>
      </div>

      {/* Choices */}
      {hasChoices && (
        <div className="mt-3 flex flex-wrap gap-2">
          {userInput.choices!.map((choice) => (
            <button
              className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-1.5 text-[12px] font-medium text-blue-200 transition hover:border-blue-400/50 hover:bg-blue-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-500 outline-none transition focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            onChange={(e) => setFreeformText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasChoices ? 'Or type your own answer…' : 'Type your answer…'}
            type="text"
            value={freeformText}
          />
          <button
            aria-label="Submit answer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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
