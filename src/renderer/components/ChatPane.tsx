import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Bot, Loader2, User } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import { getAssistantMessagePhase } from '@renderer/lib/messagePhase';
import { ModelSelect, ReasoningEffortSelect } from '@renderer/components/AgentConfigFields';

import type { PatternDefinition, ReasoningEffort } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="thinking-dot size-2 rounded-full bg-zinc-500" />
      <span className="thinking-dot size-2 rounded-full bg-zinc-500" />
      <span className="thinking-dot size-2 rounded-full bg-zinc-500" />
    </div>
  );
}

interface ChatPaneProps {
  project: ProjectRecord;
  pattern: PatternDefinition;
  session: SessionRecord;
  onSend: (content: string) => Promise<void>;
  onUpdateScratchpadConfig: (config: {
    model: string;
    reasoningEffort: ReasoningEffort;
  }) => Promise<unknown>;
}

export function ChatPane({
  project,
  pattern,
  session,
  onSend,
  onUpdateScratchpadConfig,
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const [configError, setConfigError] = useState<string>();
  const [isUpdatingScratchpadConfig, setIsUpdatingScratchpadConfig] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isSessionBusy = session.status === 'running';
  const isScratchpad = isScratchpadProject(project);
  const primaryAgent = pattern.agents[0];
  const scratchpadReasoningEffort = primaryAgent?.reasoningEffort ?? 'high';
  const isComposerDisabled = isSessionBusy || isUpdatingScratchpadConfig;

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [session.messages.length, isSessionBusy]);

  useEffect(() => {
    setConfigError(undefined);
    setIsUpdatingScratchpadConfig(false);
  }, [session.id]);

  async function handleSubmit() {
    const text = input.trim();
    if (!text || isComposerDisabled) return;
    setInput('');
    await onSend(text);
  }

  async function handleScratchpadConfigChange(config: {
    model: string;
    reasoningEffort: ReasoningEffort;
  }) {
    if (!isScratchpad || !primaryAgent || isComposerDisabled) {
      return;
    }

    if (config.model === primaryAgent.model && config.reasoningEffort === scratchpadReasoningEffort) {
      return;
    }

    setConfigError(undefined);
    setIsUpdatingScratchpadConfig(true);

    try {
      await onUpdateScratchpadConfig(config);
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUpdatingScratchpadConfig(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — extra top padding clears the title bar overlay zone */}
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 pb-3 pt-12">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-100">{session.title}</h2>
          <p className="mt-0.5 truncate text-[12px] text-zinc-500">
            {isScratchpad ? `Scratchpad · ${pattern.name}` : `${project.name} · ${pattern.name} · ${pattern.mode}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSessionBusy && (
            <span className="size-2 animate-pulse rounded-full bg-blue-400" />
          )}
          {session.status === 'error' && (
            <div className="flex items-center gap-1.5 text-[12px] text-red-400">
              <AlertCircle className="size-3.5" />
              Error
            </div>
          )}
          {session.status === 'idle' && session.messages.length > 0 && (
            <span className="text-[12px] text-zinc-600">
              {session.messages.length} message{session.messages.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={transcriptRef}>
        {session.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Bot className="size-10 text-zinc-800" />
            <p className="text-sm text-zinc-500">
              Send a message to start the conversation
            </p>
            <p className="text-[12px] text-zinc-700">
              {isScratchpad ? (
                <>
                  Scratchpad is ready for ad-hoc questions using{' '}
                  <span className="text-zinc-500">{pattern.name}</span>
                </>
              ) : (
                <>
                  Using <span className="text-zinc-500">{pattern.name}</span> in{' '}
                  <span className="text-zinc-500">{project.name}</span>
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-4">
            <div className="space-y-1">
              {session.messages.map((message, index) => {
                const isUser = message.role === 'user';
                const phase = getAssistantMessagePhase(session, message, index);
                const assistantContainerClass =
                  phase === 'thinking'
                    ? 'border-sky-500/20 bg-sky-500/5'
                    : phase === 'final'
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-zinc-800 bg-zinc-900/40';
                const assistantBadgeClass =
                  phase === 'thinking'
                    ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
                    : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
                const phaseLabel =
                  phase === 'thinking' ? 'Thinking' : phase === 'final' ? 'Final' : undefined;

                return (
                  <div className="group py-3" key={message.id}>
                    <div className="flex gap-3">
                      <div
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                          isUser
                            ? 'bg-indigo-600 text-white'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-zinc-400">
                          <span>{message.authorName}</span>
                          {!isUser && phaseLabel && (
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${assistantBadgeClass}`}
                            >
                              {phaseLabel}
                            </span>
                          )}
                        </div>
                        <div
                          className={
                            isUser
                              ? 'text-[14px] leading-relaxed text-zinc-200'
                              : `rounded-xl border px-4 py-3 text-[14px] leading-relaxed text-zinc-200 ${assistantContainerClass}`
                          }
                        >
                          <MarkdownContent content={message.content} />
                          {message.pending && message.content && (
                            <span className="mt-1 inline-block h-4 w-[2px] animate-pulse rounded-sm bg-zinc-400" />
                          )}
                        </div>
                        {message.pending && !message.content && <ThinkingDots />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--color-border)] px-6 py-4">
        {session.lastError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <span>{session.lastError}</span>
          </div>
        )}

        {configError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <span>{configError}</span>
          </div>
        )}

        <div className="mx-auto max-w-3xl">
          {isScratchpad && primaryAgent && (
            <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <ModelSelect
                    disabled={isComposerDisabled}
                    onChange={(model) =>
                      void handleScratchpadConfigChange({
                        model,
                        reasoningEffort: scratchpadReasoningEffort,
                      })
                    }
                    value={primaryAgent.model}
                  />
                </div>
                <div className="sm:w-44">
                  <ReasoningEffortSelect
                    disabled={isComposerDisabled}
                    label="Thinking"
                    onChange={(reasoningEffort) =>
                      void handleScratchpadConfigChange({
                        model: primaryAgent.model,
                        reasoningEffort,
                      })
                    }
                    value={scratchpadReasoningEffort}
                  />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Applies to future replies in this scratchpad.
              </p>
            </div>
          )}

          <div className="relative rounded-xl border border-zinc-700 bg-zinc-900 transition-colors focus-within:border-indigo-500/50">
            <textarea
              className="auto-resize-textarea block w-full resize-none bg-transparent px-4 py-3 pr-12 text-[14px] text-zinc-100 placeholder-zinc-600 outline-none"
              disabled={isComposerDisabled}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isSessionBusy
                  ? 'Waiting for response...'
                  : isUpdatingScratchpadConfig
                    ? 'Saving scratchpad settings...'
                    : 'Message...'
              }
              ref={textareaRef}
              rows={1}
              value={input}
            />
            <button
              className={`absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-lg transition ${
                input.trim() && !isComposerDisabled
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : 'bg-zinc-800 text-zinc-600'
              }`}
              disabled={isComposerDisabled || !input.trim()}
              onClick={() => void handleSubmit()}
              type="button"
            >
              {isSessionBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
