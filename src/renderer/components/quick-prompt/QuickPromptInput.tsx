import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Zap } from 'lucide-react';

import type { ModelDefinition } from '@shared/domain/models';
import type { ReasoningEffort } from '@shared/domain/workflow';

import { ModelSelector } from '@renderer/components/quick-prompt/ModelSelector';

type PromptPhase = 'idle' | 'streaming' | 'complete' | 'error';

interface QuickPromptInputProps {
  onSend: (content: string) => void;
  onCancel: () => void;
  phase: PromptPhase;
  models?: ReadonlyArray<ModelDefinition>;
  selectedModel?: ModelDefinition;
  selectedReasoning?: ReasoningEffort;
  onModelChange: (model: ModelDefinition) => void;
  onReasoningChange: (effort: ReasoningEffort | undefined) => void;
}

export function QuickPromptInput({
  onSend,
  onCancel,
  phase,
  models,
  selectedModel,
  selectedReasoning,
  onModelChange,
  onReasoningChange,
}: QuickPromptInputProps) {
  const [value, setValue] = useState('');
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount and when phase resets to idle
  useEffect(() => {
    if (phase === 'idle') {
      textareaRef.current?.focus();
    }
  }, [phase]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (phase === 'idle' && value.trim()) {
          onSend(value);
        }
      }
    },
    [onSend, value, phase],
  );

  const isDisabled = phase === 'streaming';

  return (
    <div className="relative flex flex-col">
      {/* Text input row */}
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        {/* Spark icon */}
        <div className="mt-0.5 flex-none">
          {phase === 'streaming' ? (
            <Loader2 className="size-[18px] animate-spin text-[var(--color-accent)]" />
          ) : (
            <Zap className="size-[18px] text-[var(--color-text-muted)]" />
          )}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          disabled={isDisabled}
          rows={1}
          className="auto-resize-textarea min-h-[28px] max-h-[120px] flex-1 resize-none bg-transparent font-[var(--font-body)] text-[14px] leading-[1.6] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] disabled:opacity-40"
        />

        {/* Cancel button during streaming */}
        {phase === 'streaming' && (
          <button
            onClick={onCancel}
            className="mt-0.5 flex-none rounded-md px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
            type="button"
          >
            Stop
          </button>
        )}
      </div>

      {/* Model selector row */}
      <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)] px-5 py-2">
        <button
          onClick={() => setModelSelectorOpen((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={modelSelectorOpen}
        >
          <span className="font-medium">{selectedModel?.name ?? 'Select model'}</span>
          {selectedReasoning && (
            <span className="rounded bg-[var(--color-accent-muted)] px-1.5 py-px text-[10px] text-[var(--color-text-accent)]">
              {selectedReasoning}
            </span>
          )}
          <ChevronDown className="size-3" />
        </button>

        <span className="ml-auto text-[10px] text-[var(--color-text-muted)] select-none opacity-60">
          Enter ↵ to send · Esc to dismiss
        </span>
      </div>

      {/* Model selector dropdown */}
      {modelSelectorOpen && models && (
        <ModelSelector
          models={models}
          selectedModelId={selectedModel?.id}
          selectedReasoning={selectedReasoning}
          onSelect={(model) => {
            onModelChange(model);
            setModelSelectorOpen(false);
          }}
          onReasoningChange={onReasoningChange}
          onClose={() => setModelSelectorOpen(false)}
        />
      )}
    </div>
  );
}
