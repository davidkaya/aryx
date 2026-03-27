import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Bot, Circle, ClipboardList, GitBranch, Loader2, MessageCircleQuestion, ShieldAlert, Square, User } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import { MarkdownComposer, type MarkdownComposerHandle } from '@renderer/components/MarkdownComposer';
import { ApprovalBanner, QueuedApprovalsList } from '@renderer/components/chat/ApprovalBanner';
import { PlanReviewBanner } from '@renderer/components/chat/PlanReviewBanner';
import { McpAuthBanner } from '@renderer/components/chat/McpAuthBanner';
import { UserInputBanner } from '@renderer/components/chat/UserInputBanner';
import { InlineApprovalPill, InlineModelPill, InlineThinkingPill, InlineToolsPill } from '@renderer/components/chat/InlinePills';
import { ThinkingDots } from '@renderer/components/chat/ThinkingDots';
import { getAssistantMessagePhase } from '@renderer/lib/messagePhase';
import type { ApprovalDecision } from '@shared/domain/approval';
import type { InteractionMode } from '@shared/contracts/sidecar';
import {
  findModel,
  getSupportedReasoningEfforts,
  resolveReasoningEffort,
  type ModelDefinition,
} from '@shared/domain/models';
import { type PatternDefinition, type ReasoningEffort } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import { resolveSessionToolingSelection, type SessionRecord } from '@shared/domain/session';
import {
  listApprovalToolDefinitions,
  type RuntimeToolDefinition,
  type SessionToolingSelection,
  type WorkspaceToolingSettings,
} from '@shared/domain/tooling';

/* ── ChatPane ──────────────────────────────────────────────── */

interface ChatPaneProps {
  project: ProjectRecord;
  pattern: PatternDefinition;
  session: SessionRecord;
  availableModels: ReadonlyArray<ModelDefinition>;
  toolingSettings: WorkspaceToolingSettings;
  runtimeTools?: ReadonlyArray<RuntimeToolDefinition>;
  onSend: (content: string) => Promise<void>;
  onCancelTurn?: () => void;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => Promise<unknown>;
  onResolveUserInput?: (userInputId: string, answer: string, wasFreeform: boolean) => Promise<unknown>;
  onSetInteractionMode?: (mode: InteractionMode) => void;
  onDismissPlanReview?: () => void;
  onDismissMcpAuth?: () => void;
  onUpdateSessionModelConfig?: (config: {
    model: string;
    reasoningEffort?: ReasoningEffort;
  }) => Promise<unknown>;
  onUpdateSessionTooling?: (selection: SessionToolingSelection) => void;
  onUpdateSessionApprovalSettings?: (settings: { autoApprovedToolNames?: string[] }) => void;
}

export function ChatPane({
  project,
  pattern,
  session,
  availableModels,
  toolingSettings,
  runtimeTools,
  onSend,
  onCancelTurn,
  onResolveApproval,
  onResolveUserInput,
  onSetInteractionMode,
  onDismissPlanReview,
  onDismissMcpAuth,
  onUpdateSessionModelConfig,
  onUpdateSessionTooling,
  onUpdateSessionApprovalSettings,
}: ChatPaneProps) {
  const [hasComposerContent, setHasComposerContent] = useState(false);
  const [configError, setConfigError] = useState<string>();
  const [approvalError, setApprovalError] = useState<string>();
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const [isSubmittingUserInput, setIsSubmittingUserInput] = useState(false);
  const [isUpdatingSessionModelConfig, setIsUpdatingSessionModelConfig] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<MarkdownComposerHandle>(null);

  const isSessionBusy = session.status === 'running';
  const pendingApproval = session.pendingApproval?.status === 'pending' ? session.pendingApproval : undefined;
  const queuedApprovals = (session.pendingApprovalQueue ?? []).filter((a) => a.status === 'pending');
  const totalPendingCount = (pendingApproval ? 1 : 0) + queuedApprovals.length;
  const pendingUserInput = session.pendingUserInput?.status === 'pending' ? session.pendingUserInput : undefined;
  const pendingPlanReview = session.pendingPlanReview?.status === 'pending' ? session.pendingPlanReview : undefined;
  const pendingMcpAuth = session.pendingMcpAuth?.status === 'pending' || session.pendingMcpAuth?.status === 'authenticating'
    || session.pendingMcpAuth?.status === 'failed'
    ? session.pendingMcpAuth
    : undefined;
  const interactionMode: InteractionMode = session.interactionMode ?? 'interactive';
  const isPlanMode = interactionMode === 'plan';
  const isScratchpad = isScratchpadProject(project);
  const isSingleAgent = pattern.agents.length === 1;
  const primaryAgent = pattern.agents[0];
  const selectedModel = primaryAgent ? findModel(primaryAgent.model, availableModels) : undefined;
  const supportedEfforts = getSupportedReasoningEfforts(selectedModel);
  const sessionReasoningEffort = resolveReasoningEffort(selectedModel, primaryAgent?.reasoningEffort);
  const isComposerDisabled = isSessionBusy || isUpdatingSessionModelConfig;
  const canSubmitInput = hasComposerContent && !isComposerDisabled;

  const toolSelection = useMemo(() => resolveSessionToolingSelection(session), [session]);
  const mcpServers = toolingSettings.mcpServers;
  const lspProfiles = toolingSettings.lspProfiles;
  const hasConfigurableTools = mcpServers.length > 0 || lspProfiles.length > 0;
  const hasToolCallApproval = pattern.approvalPolicy?.rules.some((r) => r.kind === 'tool-call') ?? false;
  const approvalTools = useMemo(
    () => listApprovalToolDefinitions(toolingSettings, runtimeTools),
    [runtimeTools, toolingSettings],
  );
  const isApprovalOverridden = session.approvalSettings !== undefined;
  const effectiveAutoApproved = useMemo(
    () => new Set(
      isApprovalOverridden
        ? session.approvalSettings!.autoApprovedToolNames
        : pattern.approvalPolicy?.autoApprovedToolNames ?? [],
    ),
    [isApprovalOverridden, session.approvalSettings, pattern.approvalPolicy],
  );

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [session.messages.length, isSessionBusy]);

  useEffect(() => {
    setConfigError(undefined);
    setApprovalError(undefined);
    setIsResolvingApproval(false);
    setIsUpdatingSessionModelConfig(false);
  }, [session.id]);

  function handleComposerSubmit(content: string) {
    void onSend(content);
  }

  function handleDismissPlan() {
    onDismissPlanReview?.();
  }

  function handleDismissMcpAuth() {
    onDismissMcpAuth?.();
  }

  async function handleSessionModelConfigChange(config: {
    model: string;
    reasoningEffort?: ReasoningEffort;
  }) {
    if (!isSingleAgent || !primaryAgent || isComposerDisabled || !onUpdateSessionModelConfig) {
      return;
    }

    if (
      config.model === primaryAgent.model &&
      config.reasoningEffort === sessionReasoningEffort
    ) {
      return;
    }

    setConfigError(undefined);
    setIsUpdatingSessionModelConfig(true);

    try {
      await onUpdateSessionModelConfig(config);
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUpdatingSessionModelConfig(false);
    }
  }

  async function handleResolveApproval(decision: ApprovalDecision) {
    if (!pendingApproval || !onResolveApproval || isResolvingApproval) return;

    setApprovalError(undefined);
    setIsResolvingApproval(true);

    try {
      await onResolveApproval(pendingApproval.id, decision);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsResolvingApproval(false);
    }
  }

  async function handleResolveUserInput(answer: string, wasFreeform: boolean) {
    if (!pendingUserInput || !onResolveUserInput || isSubmittingUserInput) return;

    setIsSubmittingUserInput(true);

    try {
      await onResolveUserInput(pendingUserInput.id, answer, wasFreeform);
    } catch {
      // User input errors are non-critical; the turn will fail and show the error status
    } finally {
      setIsSubmittingUserInput(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — extra top padding clears the title bar overlay zone */}
      <header className="drag-region border-b border-[var(--color-border)] px-6 pb-3 pt-3">
        <div className="flex min-h-8 items-center justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold leading-tight text-zinc-100">{session.title}</h2>
            <p className="truncate text-[11px] leading-tight text-zinc-500">
              {isScratchpad
                ? `Scratchpad · ${pattern.name}`
                : `${project.name} · ${pattern.name} · ${pattern.mode}`}
              {!isScratchpad && project.git?.status === 'ready' && (
                <span className="ml-2 inline-flex items-center gap-1 text-zinc-600">
                  <GitBranch className="inline size-2.5" />
                  {project.git.branch ?? project.git.head?.shortHash ?? 'HEAD'}
                  {project.git.isDirty && (
                    <Circle className="inline size-1.5 fill-amber-500 text-amber-500" />
                  )}
                  {(project.git.ahead ?? 0) > 0 && <span>↑{project.git.ahead}</span>}
                  {(project.git.behind ?? 0) > 0 && <span>↓{project.git.behind}</span>}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pendingApproval && (
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-400">
                <ShieldAlert className="size-3.5" />
                Awaiting approval
                {queuedApprovals.length > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] tabular-nums">
                    +{queuedApprovals.length} queued
                  </span>
                )}
              </div>
            )}
            {pendingUserInput && !pendingApproval && (
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-blue-400">
                <MessageCircleQuestion className="size-3.5" />
                Awaiting your input
              </div>
            )}
            {isSessionBusy && !pendingApproval && !pendingUserInput && <span className="size-2 animate-pulse rounded-full bg-blue-400" />}
            {session.status === 'error' && (
              <div className="flex items-center gap-1.5 text-[12px] text-red-400">
                <AlertCircle className="size-3.5" />
                Error
              </div>
            )}
            {session.status === 'idle' && !pendingApproval && !pendingUserInput && session.messages.length > 0 && (
              <span className="text-[12px] text-zinc-600">
                {session.messages.length} message{session.messages.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={transcriptRef}>
        {session.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Bot className="size-10 text-zinc-800" />
            <p className="text-[13px] text-zinc-500">Send a message to start the conversation</p>
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
                  <div className="group py-3" data-message-id={message.id} key={message.id}>
                    <div className="flex gap-3">
                      <div
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                          isUser ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'
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
                          {!isUser && message.pending ? (
                            <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-zinc-200">
                              {message.content}
                            </div>
                          ) : (
                            <MarkdownContent content={message.content} />
                          )}
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

        {approvalError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <span>{approvalError}</span>
          </div>
        )}

        <div className="mx-auto max-w-3xl">
          {/* Pending approval banner */}
          {pendingApproval && (
            <div className="mb-3 space-y-2">
              <ApprovalBanner
                approval={pendingApproval}
                isResolving={isResolvingApproval}
                onResolve={(decision) => void handleResolveApproval(decision)}
                position={totalPendingCount > 1 ? 1 : undefined}
                total={totalPendingCount > 1 ? totalPendingCount : undefined}
              />
              {queuedApprovals.length > 0 && (
                <QueuedApprovalsList approvals={queuedApprovals} />
              )}
            </div>
          )}

          {/* Pending user input banner */}
          {pendingUserInput && (
            <div className="mb-3">
              <UserInputBanner
                isSubmitting={isSubmittingUserInput}
                onSubmit={(answer, wasFreeform) => void handleResolveUserInput(answer, wasFreeform)}
                userInput={pendingUserInput}
              />
            </div>
          )}

          {/* Plan review banner */}
          {pendingPlanReview && (
            <div className="mb-3">
              <PlanReviewBanner
                onDismiss={handleDismissPlan}
                planReview={pendingPlanReview}
              />
            </div>
          )}

          {/* MCP auth required banner */}
          {pendingMcpAuth && (
            <div className="mb-3">
              <McpAuthBanner
                mcpAuth={pendingMcpAuth}
                onDismiss={handleDismissMcpAuth}
              />
            </div>
          )}

          {/* Session config pills — tools/approval left, model/reasoning right */}
          {isSingleAgent && (
            <div className="mb-2 flex items-center gap-2">
              {hasConfigurableTools && onUpdateSessionTooling && (
                <InlineToolsPill
                  disabled={isComposerDisabled}
                  lspProfiles={lspProfiles}
                  mcpServers={mcpServers}
                  onToggle={onUpdateSessionTooling}
                  selection={toolSelection}
                />
              )}
              {hasToolCallApproval && onUpdateSessionApprovalSettings && approvalTools.length > 0 && (
                <InlineApprovalPill
                  approvalTools={approvalTools}
                  disabled={isComposerDisabled}
                  effectiveAutoApproved={effectiveAutoApproved}
                  isOverridden={isApprovalOverridden}
                  onUpdate={onUpdateSessionApprovalSettings}
                />
              )}
              {primaryAgent && (
                <div className="ml-auto flex items-center gap-2">
                  <InlineModelPill
                    disabled={isComposerDisabled}
                    models={availableModels}
                    onChange={(modelId) => {
                      const nextModel = findModel(modelId, availableModels);
                      void handleSessionModelConfigChange({
                        model: modelId,
                        reasoningEffort: resolveReasoningEffort(nextModel, sessionReasoningEffort),
                      });
                    }}
                    value={primaryAgent.model}
                  />
                  <InlineThinkingPill
                    disabled={isComposerDisabled}
                    onChange={(reasoningEffort) =>
                      void handleSessionModelConfigChange({
                        model: primaryAgent.model,
                        reasoningEffort,
                      })
                    }
                    supportedEfforts={supportedEfforts}
                    value={sessionReasoningEffort}
                  />
                  {isUpdatingSessionModelConfig && (
                    <Loader2 className="size-3 animate-spin text-zinc-500" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Session config pills — tool & approval controls (multi-agent) */}
          {!isSingleAgent && (hasConfigurableTools || hasToolCallApproval) && (
            <div className="mb-2 flex items-center gap-2">
              {hasConfigurableTools && onUpdateSessionTooling && (
                <InlineToolsPill
                  disabled={isComposerDisabled}
                  lspProfiles={lspProfiles}
                  mcpServers={mcpServers}
                  onToggle={onUpdateSessionTooling}
                  selection={toolSelection}
                />
              )}
              {hasToolCallApproval && onUpdateSessionApprovalSettings && approvalTools.length > 0 && (
                <InlineApprovalPill
                  approvalTools={approvalTools}
                  disabled={isComposerDisabled}
                  effectiveAutoApproved={effectiveAutoApproved}
                  isOverridden={isApprovalOverridden}
                  onUpdate={onUpdateSessionApprovalSettings}
                />
              )}
            </div>
          )}

          <div className="rounded-xl border border-zinc-700 bg-zinc-900 transition-colors focus-within:border-indigo-500/50">
            <MarkdownComposer
              ref={composerRef}
              disabled={isComposerDisabled}
              onContentChange={setHasComposerContent}
              onSubmit={handleComposerSubmit}
              placeholder={
                pendingApproval
                  ? 'Awaiting approval...'
                  : pendingUserInput
                    ? 'Awaiting your input above...'
                    : pendingPlanReview
                      ? 'Review the plan above...'
                      : pendingMcpAuth
                        ? 'MCP server requires authentication...'
                        : isSessionBusy
                        ? 'Waiting for response...'
                        : isUpdatingSessionModelConfig
                          ? 'Saving model settings...'
                          : isPlanMode
                            ? 'Describe what to plan...'
                            : 'Message...'
              }
            >
              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                {/* Plan mode toggle */}
                {onSetInteractionMode && !isSessionBusy && (
                  <button
                    aria-label={isPlanMode ? 'Switch to interactive mode' : 'Switch to plan mode'}
                    aria-pressed={isPlanMode}
                    className={`flex size-8 items-center justify-center rounded-lg transition ${
                      isPlanMode
                        ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                        : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                    }`}
                    disabled={isComposerDisabled}
                    onClick={() => onSetInteractionMode(isPlanMode ? 'interactive' : 'plan')}
                    type="button"
                  >
                    <ClipboardList className="size-3.5" />
                  </button>
                )}

                {/* Send / Stop button */}
                <button
                  className={`flex size-8 items-center justify-center rounded-lg transition ${
                    isSessionBusy
                      ? 'bg-red-600/80 text-white hover:bg-red-500'
                      : canSubmitInput
                        ? isPlanMode
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : 'bg-indigo-600 text-white hover:bg-indigo-500'
                        : 'bg-zinc-800 text-zinc-600'
                  }`}
                  disabled={!canSubmitInput && !isSessionBusy}
                  onClick={() => {
                    if (isSessionBusy) {
                      onCancelTurn?.();
                    } else {
                      composerRef.current?.submit();
                    }
                  }}
                  type="button"
                  aria-label={isSessionBusy ? 'Stop generating' : isPlanMode ? 'Send as plan request' : 'Send message'}
                >
                  {isSessionBusy ? (
                    <Square className="size-3.5" fill="currentColor" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </button>
              </div>
            </MarkdownComposer>
            {isPlanMode && !isSessionBusy && (
              <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-0.5">
                <div className="size-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-medium text-emerald-400/80">
                  Plan mode — the agent will propose a plan instead of implementing
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
