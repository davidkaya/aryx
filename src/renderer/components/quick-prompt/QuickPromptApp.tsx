import { useCallback, useEffect, useRef, useState } from 'react';

import type { QuickPromptElectronApi, QuickPromptCapabilities } from '@shared/contracts/ipc';
import type { SessionEventRecord } from '@shared/domain/event';
import type { ReasoningEffort } from '@shared/domain/workflow';
import type { ModelDefinition } from '@shared/domain/models';

import { QuickPromptInput } from '@renderer/components/quick-prompt/QuickPromptInput';
import { QuickPromptResponse } from '@renderer/components/quick-prompt/QuickPromptResponse';
import { QuickPromptActions } from '@renderer/components/quick-prompt/QuickPromptActions';

declare global {
  interface Window {
    quickPromptApi: QuickPromptElectronApi;
  }
}

type PromptPhase = 'idle' | 'streaming' | 'complete' | 'error';

/**
 * Per-message state tracked by messageId, mirroring the main app's
 * SessionRecord.messages model. This is necessary because the sidecar's
 * fire-and-forget event handlers can emit events out of order — e.g.
 * `message-complete` and `status: idle` can arrive before all
 * `message-delta` events have been emitted.
 */
interface TrackedMessage {
  content: string;
  messageKind?: string;
  authorName: string;
  pending: boolean;
  finalized: boolean;
}

/** Derive display values from tracked messages. */
function deriveDisplay(messages: Map<string, TrackedMessage>) {
  let content = '';
  let thinkingContent = '';
  let authorName = '';
  let hasVisibleContent = false;
  let allComplete = messages.size > 0;

  for (const msg of messages.values()) {
    if (msg.messageKind === 'thinking') {
      if (msg.content) thinkingContent += (thinkingContent ? '\n' : '') + msg.content;
    } else {
      // Last non-thinking message wins as the response
      content = msg.content;
      authorName = msg.authorName;
      if (msg.content.length > 0) hasVisibleContent = true;
    }
    if (msg.pending) allComplete = false;
  }

  return { content, thinkingContent, authorName, isComplete: allComplete && hasVisibleContent };
}

export function QuickPromptApp() {
  const [phase, setPhase] = useState<PromptPhase>('idle');
  const [displayContent, setDisplayContent] = useState('');
  const [displayThinking, setDisplayThinking] = useState('');
  const [displayAuthor, setDisplayAuthor] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [capabilities, setCapabilities] = useState<QuickPromptCapabilities>();
  const [selectedModel, setSelectedModel] = useState<string>();
  const [selectedReasoning, setSelectedReasoning] = useState<ReasoningEffort>();
  const [visible, setVisible] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Map<string, TrackedMessage>>(new Map());
  const api = window.quickPromptApi;

  /** Push tracked-message state into React display state. */
  const syncDisplay = useCallback(() => {
    const display = deriveDisplay(messagesRef.current);
    setDisplayContent(display.content);
    setDisplayThinking(display.thinkingContent);
    setDisplayAuthor(display.authorName);
    return display;
  }, []);

  // Load capabilities on mount
  useEffect(() => {
    api.getCapabilities().then((caps) => {
      setCapabilities(caps);
      setSelectedModel(caps.defaultModel ?? caps.models[0]?.id);
      setSelectedReasoning(caps.defaultReasoningEffort);
    });
  }, [api]);

  // Subscribe to show/hide events from main process
  useEffect(() => {
    const offShow = api.onShow((theme: string) => {
      const effective = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      document.documentElement.dataset.theme = effective;

      setVisible(true);
      resetState();
    });
    const offHide = api.onHide(() => setVisible(false));
    return () => {
      offShow();
      offHide();
    };
  }, [api]);

  // Subscribe to session events (streaming) — processes events using
  // message-by-ID tracking that tolerates out-of-order delivery.
  useEffect(() => {
    const off = api.onSessionEvent((event: SessionEventRecord) => {
      const msgs = messagesRef.current;

      if (event.kind === 'message-delta' && event.messageId && (event.contentDelta || event.content !== undefined)) {
        const existing = msgs.get(event.messageId);

        if (existing) {
          // Skip deltas that arrive after message-complete replaced the
          // content with the authoritative final version.
          if (existing.finalized) return;

          if (event.content !== undefined) {
            existing.content = event.content;
          } else if (event.contentDelta) {
            existing.content += event.contentDelta;
          }
          existing.authorName = event.authorName ?? existing.authorName;
        } else {
          msgs.set(event.messageId, {
            content: event.contentDelta ?? event.content ?? '',
            messageKind: event.messageKind,
            authorName: event.authorName ?? '',
            pending: true,
            finalized: false,
          });
        }

        syncDisplay();
        setPhase('streaming');

      } else if (event.kind === 'message-complete' && event.messageId) {
        const existing = msgs.get(event.messageId);
        if (existing) {
          if (event.content !== undefined) existing.content = event.content;
          existing.pending = false;
          existing.finalized = true;
        } else {
          msgs.set(event.messageId, {
            content: event.content ?? '',
            messageKind: undefined,
            authorName: event.authorName ?? '',
            pending: false,
            finalized: true,
          });
        }

        const display = syncDisplay();
        if (display.isComplete) setPhase('complete');

      } else if (event.kind === 'message-reclassified' && event.messageId && event.messageKind) {
        const existing = msgs.get(event.messageId);
        if (existing) {
          existing.messageKind = event.messageKind;
          syncDisplay();
        }

      } else if (event.kind === 'status' && event.status === 'idle') {
        for (const msg of msgs.values()) {
          msg.pending = false;
        }
        const display = syncDisplay();
        if (display.isComplete) setPhase('complete');

      } else if (event.kind === 'error') {
        setErrorMessage(event.error ?? 'An unexpected error occurred.');
        setPhase('error');
      }
    });
    return off;
  }, [api, syncDisplay]);

  const resetState = useCallback(() => {
    setPhase('idle');
    setDisplayContent('');
    setDisplayThinking('');
    setDisplayAuthor('');
    setErrorMessage(undefined);
    sessionIdRef.current = null;
    messagesRef.current = new Map();
    api.getCapabilities().then((caps) => {
      setCapabilities(caps);
      setSelectedModel(caps.defaultModel ?? caps.models[0]?.id);
      setSelectedReasoning(caps.defaultReasoningEffort);
    });
  }, [api]);

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || phase === 'streaming') return;

    setPhase('streaming');
    setDisplayContent('');
    setDisplayThinking('');
    setDisplayAuthor('');
    setErrorMessage(undefined);
    messagesRef.current = new Map();

    try {
      const result = await api.send({
        content,
        model: selectedModel,
        reasoningEffort: selectedReasoning,
      });
      sessionIdRef.current = result.sessionId;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send message.');
      setPhase('error');
    }
  }, [api, phase, selectedModel, selectedReasoning]);

  const handleCancel = useCallback(() => {
    api.cancelTurn();
    setPhase('complete');
  }, [api]);

  const handleDiscard = useCallback(() => {
    api.discard();
    resetState();
  }, [api, resetState]);

  const handleClose = useCallback(() => {
    api.close();
    resetState();
  }, [api, resetState]);

  const handleContinueInAryx = useCallback(() => {
    api.continueInAryx();
    resetState();
  }, [api, resetState]);

  const handleModelChange = useCallback((model: ModelDefinition) => {
    setSelectedModel(model.id);
  }, []);

  const handleReasoningChange = useCallback((effort: ReasoningEffort | undefined) => {
    setSelectedReasoning(effort);
  }, []);

  // Global keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (phase === 'streaming') {
          handleCancel();
        } else if (phase === 'complete' || phase === 'error') {
          handleClose();
        } else {
          api.close();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [phase, handleCancel, handleClose, api]);

  if (!visible) return null;

  const hasResponse = phase !== 'idle';
  const resolvedModel = capabilities?.models.find((m) => m.id === selectedModel);

  return (
    <div className="qp-container flex h-screen w-screen items-start justify-center pt-0">
      <div
        className={`qp-panel qp-panel-enter flex w-full max-w-[680px] flex-col rounded-2xl ${
          phase === 'streaming' ? 'qp-border-streaming' : hasResponse ? 'qp-border-complete' : 'qp-border-idle'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Quick Prompt"
      >
        {/* Input area */}
        <QuickPromptInput
          onSend={handleSend}
          onCancel={handleCancel}
          phase={phase}
          models={capabilities?.models}
          selectedModel={resolvedModel}
          selectedReasoning={selectedReasoning}
          onModelChange={handleModelChange}
          onReasoningChange={handleReasoningChange}
        />

        {/* Response area — grows dynamically */}
        {hasResponse && (
          <QuickPromptResponse
            content={displayContent}
            thinkingContent={displayThinking}
            authorName={displayAuthor}
            phase={phase}
            error={errorMessage}
          />
        )}

        {/* Action bar */}
        {(phase === 'complete' || phase === 'error') && (
          <QuickPromptActions
            onDiscard={handleDiscard}
            onClose={handleClose}
            onContinueInAryx={handleContinueInAryx}
          />
        )}
      </div>
    </div>
  );
}
