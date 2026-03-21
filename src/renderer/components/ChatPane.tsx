import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Bot, Loader2, User } from 'lucide-react';

import {
  buildAgentActivityRows,
  formatAgentActivityLabel,
  isAgentActivityActive,
  isAgentActivityCompleted,
  type SessionActivityState,
} from '@renderer/lib/sessionActivity';
import type { PatternDefinition } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
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
  activity?: SessionActivityState;
  project: ProjectRecord;
  pattern: PatternDefinition;
  session: SessionRecord;
  onSend: (content: string) => Promise<void>;
}

export function ChatPane({ activity, project, pattern, session, onSend }: ChatPaneProps) {
  const [input, setInput] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isBusy = session.status === 'running';
  const activityRows = useMemo(
    () => buildAgentActivityRows(activity, pattern.agents),
    [activity, pattern.agents],
  );
  const hasObservedActivity = activityRows.some((row) => !!row.activity);
  const showActivityPanel = (isBusy || hasObservedActivity) && activityRows.length > 0;

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [session.messages.length, isBusy]);

  async function handleSubmit() {
    const text = input.trim();
    if (!text || isBusy) return;
    setInput('');
    await onSend(text);
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
            {project.name} · {pattern.name} · {pattern.mode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {session.status === 'running' && (
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
              Using <span className="text-zinc-500">{pattern.name}</span> in{' '}
              <span className="text-zinc-500">{project.name}</span>
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-4">
            <div className="space-y-1">
              {session.messages.map((message) => {
                const isUser = message.role === 'user';
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
                        <div className="mb-1 text-[12px] font-medium text-zinc-400">
                          {message.authorName}
                        </div>
                        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-200">
                          {message.content}
                          {message.pending && message.content && (
                            <span className="ml-0.5 inline-block h-[18px] w-[2px] animate-pulse rounded-sm bg-zinc-400 align-text-bottom" />
                          )}
                        </div>
                        {message.pending && !message.content && <ThinkingDots />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {showActivityPanel && (
              <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
                  Agent activity
                </div>
                <div className="space-y-2.5">
                  {activityRows.map((row) => (
                    <div className="flex items-start gap-3" key={row.key}>
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          isAgentActivityActive(row.activity)
                            ? 'animate-pulse bg-blue-400'
                            : isAgentActivityCompleted(row.activity)
                              ? 'bg-emerald-400'
                              : 'bg-zinc-700'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-zinc-300">{row.agentName}</div>
                        <div className="text-[12px] text-zinc-500">
                          {formatAgentActivityLabel(row.activity)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

        <div className="mx-auto max-w-3xl">
          <div className="relative rounded-xl border border-zinc-700 bg-zinc-900 transition-colors focus-within:border-indigo-500/50">
            <textarea
              className="auto-resize-textarea block w-full resize-none bg-transparent px-4 py-3 pr-12 text-[14px] text-zinc-100 placeholder-zinc-600 outline-none"
              disabled={isBusy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isBusy ? 'Waiting for response...' : 'Message...'}
              ref={textareaRef}
              rows={1}
              value={input}
            />
            <button
              className={`absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-lg transition ${
                input.trim() && !isBusy
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : 'bg-zinc-800 text-zinc-600'
              }`}
              disabled={isBusy || !input.trim()}
              onClick={() => void handleSubmit()}
              type="button"
            >
              {isBusy ? (
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
