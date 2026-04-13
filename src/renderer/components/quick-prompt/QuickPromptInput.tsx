import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Square, Sparkles } from 'lucide-react';

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

  // Auto-focus when phase resets to idle
  useEffect(() => {
    if (phase === 'idle') {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [phase]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

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

  const reasoningLabel = selectedReasoning
    ? selectedReasoning === 'xhigh' ? 'xHigh' : selectedReasoning.charAt(0).toUpperCase() + selectedReasoning.slice(1)
    : undefined;

  return (
    <div className="relative flex flex-col">
      {/* Primary input area */}
      <div className="flex items-start gap-3 px-5 pt-4 pb-2">
        <div className="mt-1 flex-none">
          {phase === 'streaming' ? (
            <Loader2 className="size-[18px] animate-spin text-[var(--color-accent)]" aria-label="Processing" />
          ) : (
            <Sparkles className="size-[18px] text-[var(--color-text-muted)]" />
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything…"
          disabled={phase === 'streaming'}
          rows={1}
          className="min-h-[28px] max-h-[120px] flex-1 resize-none bg-transparent font-[var(--font-body)] text-[14px] leading-[1.6] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]/60 disabled:opacity-40"
          aria-label="Quick prompt input"
        />

        {phase === 'streaming' && (
          <button
            onClick={onCancel}
            className="mt-0.5 flex flex-none items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-status-error)]/40 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
            type="button"
            aria-label="Stop generating"
          >
            <Square className="size-2.5 fill-current" />
            Stop
          </button>
        )}
      </div>

      {/* Footer bar: model selector + shortcuts */}
      <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)]/60 px-5 py-2">
        <button
          onClick={() => setModelSelectorOpen((prev) => !prev)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition ${
            modelSelectorOpen
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-accent)]'
              : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]'
          }`}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={modelSelectorOpen}
        >
          <span className="max-w-[160px] truncate font-medium">{selectedModel?.name ?? 'Select model'}</span>
          {reasoningLabel && (
            <span className="rounded-[4px] bg-[var(--color-accent)]/15 px-1.5 py-px text-[9px] font-semibold tracking-wide text-[var(--color-text-accent)] uppercase">
              {reasoningLabel}
            </span>
          )}
          <ChevronDown className={`size-3 transition-transform ${modelSelectorOpen ? 'rotate-180' : ''}`} />
        </button>

        <span className="ml-auto flex items-center gap-3 text-[10px] text-[var(--color-text-muted)] select-none opacity-50">
          <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-1 py-px font-mono text-[9px]">
            ↵
          </kbd>
          <span>Send</span>
          <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-1 py-px font-mono text-[9px]">
            Esc
          </kbd>
          <span>Dismiss</span>
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
