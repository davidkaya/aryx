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

interface StreamedMessage {
  content: string;
  thinkingContent: string;
  authorName: string;
}

export function QuickPromptApp() {
  const [phase, setPhase] = useState<PromptPhase>('idle');
  const [response, setResponse] = useState<StreamedMessage>({ content: '', thinkingContent: '', authorName: '' });
  const [errorMessage, setErrorMessage] = useState<string>();
  const [capabilities, setCapabilities] = useState<QuickPromptCapabilities>();
  const [selectedModel, setSelectedModel] = useState<string>();
  const [selectedReasoning, setSelectedReasoning] = useState<ReasoningEffort>();
  const [visible, setVisible] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const api = window.quickPromptApi;

  // Load capabilities on mount
  useEffect(() => {
    api.getCapabilities().then((caps) => {
      setCapabilities(caps);
      setSelectedModel(caps.defaultModel);
      setSelectedReasoning(caps.defaultReasoningEffort);
    });
  }, [api]);

  // Subscribe to show/hide events from main process
  useEffect(() => {
    const offShow = api.onShow(() => {
      setVisible(true);
      resetState();
    });
    const offHide = api.onHide(() => setVisible(false));
    return () => {
      offShow();
      offHide();
    };
  }, [api]);

  // Subscribe to session events (streaming)
  useEffect(() => {
    const off = api.onSessionEvent((event: SessionEventRecord) => {
      if (event.kind === 'message-delta' && event.contentDelta) {
        if (event.messageKind === 'thinking') {
          setResponse((prev) => ({ ...prev, thinkingContent: prev.thinkingContent + event.contentDelta! }));
        } else {
          setResponse((prev) => ({
            ...prev,
            content: prev.content + event.contentDelta!,
            authorName: event.authorName ?? prev.authorName,
          }));
        }
        setPhase('streaming');
      } else if (event.kind === 'status' && event.status === 'idle') {
        setPhase((prev) => (prev === 'streaming' ? 'complete' : prev));
      } else if (event.kind === 'error') {
        setErrorMessage(event.error ?? 'An unexpected error occurred.');
        setPhase('error');
      }
    });
    return off;
  }, [api]);

  const resetState = useCallback(() => {
    setPhase('idle');
    setResponse({ content: '', thinkingContent: '', authorName: '' });
    setErrorMessage(undefined);
    sessionIdRef.current = null;
    // Refresh capabilities in case models changed
    api.getCapabilities().then((caps) => {
      setCapabilities(caps);
      if (!selectedModel) setSelectedModel(caps.defaultModel);
      if (!selectedReasoning) setSelectedReasoning(caps.defaultReasoningEffort);
    });
  }, [api, selectedModel, selectedReasoning]);

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || phase === 'streaming') return;

    setPhase('streaming');
    setResponse({ content: '', thinkingContent: '', authorName: '' });
    setErrorMessage(undefined);

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
        className={`qp-panel qp-panel-enter flex w-full max-w-[680px] flex-col overflow-hidden rounded-2xl ${
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
            content={response.content}
            thinkingContent={response.thinkingContent}
            authorName={response.authorName}
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
