import { useEffect, useMemo, useRef, useState } from 'react';

import type { PatternDefinition } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';

interface ChatPaneProps {
  project: ProjectRecord;
  pattern: PatternDefinition;
  session: SessionRecord;
  onSend: (content: string) => Promise<void>;
}

export function ChatPane({ project, pattern, session, onSend }: ChatPaneProps) {
  const [input, setInput] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [session.messages.length]);

  const isBusy = session.status === 'running';
  const sessionStats = useMemo(
    () => `${session.messages.length} messages • ${pattern.agents.length} agent${pattern.agents.length === 1 ? '' : 's'}`,
    [pattern.agents.length, session.messages.length],
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-slate-800 px-8 py-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{project.name}</div>
            <h2 className="mt-2 text-2xl font-semibold text-white">{session.title}</h2>
            <p className="mt-2 text-sm text-slate-400">
              Pattern: <span className="font-medium text-slate-200">{pattern.name}</span> • Mode:{' '}
              <span className="font-medium text-slate-200">{pattern.mode}</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">{sessionStats}</p>
          </div>
          <div
            className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${
              session.status === 'error'
                ? 'bg-rose-500/15 text-rose-200'
                : session.status === 'running'
                  ? 'bg-sky-500/15 text-sky-200'
                  : 'bg-slate-800 text-slate-200'
            }`}
          >
            {session.status}
          </div>
        </div>
      </header>

      <div
        className="flex-1 overflow-y-auto px-8 py-6"
        ref={transcriptRef}
      >
        {session.messages.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/60 px-6 py-8 text-sm text-slate-400">
            Start the conversation to launch this orchestration against <span className="font-medium text-slate-200">{project.path}</span>.
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {session.messages.map((message) => {
              const isUser = message.role === 'user';
              return (
                <div
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  key={message.id}
                >
                  <div
                    className={`max-w-3xl rounded-3xl px-5 py-4 shadow-sm ${
                      isUser
                        ? 'bg-sky-500 text-slate-950'
                        : 'border border-slate-800 bg-slate-900/85 text-slate-100'
                    }`}
                  >
                    <div className={`text-xs font-semibold uppercase tracking-wide ${isUser ? 'text-slate-800' : 'text-slate-400'}`}>
                      {message.authorName}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                    {message.pending ? (
                      <div className="mt-3 text-xs text-slate-400">Streaming…</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-slate-800 px-8 py-5">
        {session.lastError ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {session.lastError}
          </div>
        ) : null}

        <form
          className="mx-auto flex max-w-4xl flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!input.trim()) {
              return;
            }

            const nextInput = input;
            setInput('');
            await onSend(nextInput);
          }}
        >
          <textarea
            className="min-h-28 w-full rounded-3xl border border-slate-700 bg-slate-900 px-5 py-4 text-sm text-slate-100 shadow-inner outline-none transition focus:border-sky-500"
            disabled={isBusy}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask the selected orchestration to reason about the current project..."
            value={input}
          />
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              The .NET sidecar replays the saved transcript so sessions can resume after app restart.
            </p>
            <button
              className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy || !input.trim()}
              type="submit"
            >
              {isBusy ? 'Running…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
