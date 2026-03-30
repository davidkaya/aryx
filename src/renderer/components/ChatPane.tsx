import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Bookmark, Bot, Circle, ClipboardList, GitBranch, Loader2, MessageCircleQuestion, Paperclip, RefreshCw, ShieldAlert, Square, User, X } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import { MarkdownComposer, type MarkdownComposerHandle } from '@renderer/components/MarkdownComposer';
import { ApprovalBanner, QueuedApprovalsList } from '@renderer/components/chat/ApprovalBanner';
import { MessageActions } from '@renderer/components/chat/MessageActions';
import { MessageEditComposer } from '@renderer/components/chat/MessageEditComposer';
import { PlanReviewBanner } from '@renderer/components/chat/PlanReviewBanner';
import { McpAuthBanner } from '@renderer/components/chat/McpAuthBanner';
import { UserInputBanner } from '@renderer/components/chat/UserInputBanner';
import { InlineApprovalPill, InlineModelPill, InlineTerminalPill, InlineThinkingPill, InlineToolsPill } from '@renderer/components/chat/InlinePills';
import { InlinePromptPill } from '@renderer/components/chat/InlinePromptPill';
import { ThinkingDots } from '@renderer/components/chat/ThinkingDots';
import { ThinkingProcess } from '@renderer/components/chat/ThinkingProcess';
import { SubagentActivityList } from '@renderer/components/chat/SubagentActivityCard';
import { getAssistantMessagePhase } from '@renderer/lib/messagePhase';
import type { ApprovalDecision } from '@shared/domain/approval';
import type { InteractionMode, MessageMode } from '@shared/contracts/sidecar';
import type { ChatMessageAttachment } from '@shared/domain/attachment';
import { getAttachmentDisplayName, isImageAttachment } from '@shared/domain/attachment';
import type { SessionUsageState } from '@renderer/lib/sessionActivity';
import type { ActiveSubagent } from '@renderer/lib/subagentTracker';
import {
  findModel,
  getSupportedReasoningEfforts,
  resolveReasoningEffort,
  type ModelDefinition,
} from '@shared/domain/models';
import { type PatternDefinition, type ReasoningEffort } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import { resolveSessionToolingSelection, type SessionBranchOriginAction, type SessionRecord } from '@shared/domain/session';
import {
  countApprovedToolsInGroups,
  groupApprovalToolsByProvider,
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
  mcpProbingServerIds?: string[];
  runtimeTools?: ReadonlyArray<RuntimeToolDefinition>;
  sessionUsage?: SessionUsageState;
  activeSubagents?: ReadonlyArray<ActiveSubagent>;
  terminalOpen?: boolean;
  terminalRunning?: boolean;
  onSend: (content: string, attachments?: ChatMessageAttachment[], messageMode?: MessageMode) => Promise<void>;
  onCancelTurn?: () => void;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision, alwaysApprove?: boolean) => Promise<unknown>;
  onResolveUserInput?: (userInputId: string, answer: string, wasFreeform: boolean) => Promise<unknown>;
  onSetInteractionMode?: (mode: InteractionMode) => void;
  onDismissPlanReview?: () => void;
  onDismissMcpAuth?: () => void;
  onAuthenticateMcp?: () => void;
  onTerminalToggle?: () => void;
  onUpdateSessionModelConfig?: (config: {
    model: string;
    reasoningEffort?: ReasoningEffort;
  }) => Promise<unknown>;
  onUpdateSessionTooling?: (selection: SessionToolingSelection) => void;
  onUpdateSessionApprovalSettings?: (settings: { autoApprovedToolNames?: string[] }) => void;
  onBranchFromMessage?: (messageId: string) => void;
  onPinMessage?: (messageId: string, isPinned: boolean) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onEditAndResendMessage?: (messageId: string, content: string) => void;
  branchOriginLabel?: string;
}

export function ChatPane({
  project,
  pattern,
  session,
  availableModels,
  toolingSettings,
  mcpProbingServerIds,
  runtimeTools,
  sessionUsage,
  activeSubagents,
  terminalOpen,
  terminalRunning,
  onSend,
  onCancelTurn,
  onResolveApproval,
  onResolveUserInput,
  onSetInteractionMode,
  onDismissPlanReview,
  onDismissMcpAuth,
  onAuthenticateMcp,
  onTerminalToggle,
  onUpdateSessionModelConfig,
  onUpdateSessionTooling,
  onUpdateSessionApprovalSettings,
  onBranchFromMessage,
  onPinMessage,
  onRegenerateMessage,
  onEditAndResendMessage,
  branchOriginLabel,
}: ChatPaneProps) {
  const [hasComposerContent, setHasComposerContent] = useState(false);
  const [configError, setConfigError] = useState<string>();
  const [approvalError, setApprovalError] = useState<string>();
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const [isSubmittingUserInput, setIsSubmittingUserInput] = useState(false);
  const [isUpdatingSessionModelConfig, setIsUpdatingSessionModelConfig] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<MarkdownComposerHandle>(null);

  const isSessionBusy = session.status === 'running';
  const { visibleMessages, thinkingMessages } = useMemo(() => {
    const visible: typeof session.messages = [];
    const thinking: typeof session.messages = [];
    for (const message of session.messages) {
      if (message.messageKind === 'thinking') {
        thinking.push(message);
      } else {
        visible.push(message);
      }
    }
    return { visibleMessages: visible, thinkingMessages: thinking };
  }, [session.messages]);
  const lastAssistantIndex = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === 'assistant') return i;
    }
    return -1;
  }, [visibleMessages]);
  const turnStartedAt = useMemo(() => {
    if (session.runs.length === 0) return undefined;
    return session.runs[0].startedAt;
  }, [session.runs]);
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
  const isComposerDisabled = isUpdatingSessionModelConfig;
  const canSubmitInput = hasComposerContent && !isComposerDisabled;
  const [pendingAttachments, setPendingAttachments] = useState<ChatMessageAttachment[]>([]);
  const promptFiles = useMemo(() => project.customization?.promptFiles ?? [], [project.customization?.promptFiles]);

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
  const effectiveAutoApprovedCount = useMemo(() => {
    const groups = groupApprovalToolsByProvider(approvalTools, toolingSettings);
    return countApprovedToolsInGroups(groups, effectiveAutoApproved);
  }, [approvalTools, effectiveAutoApproved, toolingSettings]);
  const isProbingMcp = (mcpProbingServerIds?.length ?? 0) > 0;
  const hasApprovalContent = approvalTools.length > 0 || isProbingMcp;

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
    setEditingMessageId(undefined);
  }, [session.id]);

  function handleComposerSubmit(content: string) {
    const attachments = pendingAttachments.length > 0 ? [...pendingAttachments] : undefined;
    const messageMode: MessageMode | undefined = isSessionBusy ? 'immediate' : undefined;
    setPendingAttachments([]);
    void onSend(content, attachments, messageMode);
  }

  const handleCopyMessage = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  const handleEditSave = useCallback(
    (messageId: string, content: string) => {
      setEditingMessageId(undefined);
      onEditAndResendMessage?.(messageId, content);
    },
    [onEditAndResendMessage],
  );

  function handleDismissPlan() {
    onDismissPlanReview?.();
  }

  function handleDismissMcpAuth() {
    onDismissMcpAuth?.();
  }

  function handleAuthenticateMcp() {
    onAuthenticateMcp?.();
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

  async function handleResolveApproval(decision: ApprovalDecision, alwaysApprove?: boolean) {
    if (!pendingApproval || !onResolveApproval || isResolvingApproval) return;

    setApprovalError(undefined);
    setIsResolvingApproval(true);

    try {
      await onResolveApproval(pendingApproval.id, decision, alwaysApprove);
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
      <header className="drag-region border-b border-[var(--color-border-subtle)] px-6 pb-3 pt-3">
        <div className="flex min-h-8 items-center justify-between">
          <div className="min-w-0">
            <h2 className="font-display truncate text-[13px] font-semibold leading-tight text-[var(--color-text-primary)]">{session.title}</h2>
            <p className="truncate text-[11px] leading-tight text-[var(--color-text-muted)]">
              {isScratchpad
                ? `Scratchpad · ${pattern.name}`
                : `${project.name} · ${pattern.name} · ${pattern.mode}`}
              {!isScratchpad && project.git?.status === 'ready' && (
                <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-text-muted)]">
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
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-status-warning)]">
                <ShieldAlert className="size-3.5" />
                Awaiting approval
                {queuedApprovals.length > 0 && (
                  <span className="rounded-full bg-[var(--color-status-warning)]/15 px-1.5 py-0.5 text-[10px] tabular-nums">
                    +{queuedApprovals.length} queued
                  </span>
                )}
              </div>
            )}
            {pendingUserInput && !pendingApproval && (
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-accent-sky)]">
                <MessageCircleQuestion className="size-3.5" />
                Awaiting your input
              </div>
            )}
            {isSessionBusy && !pendingApproval && !pendingUserInput && <span className="size-2 animate-pulse rounded-full bg-[var(--color-accent-sky)]" />}
            {session.status === 'error' && (
              <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-status-error)]">
                <AlertCircle className="size-3.5" />
                Error
              </div>
            )}
            {session.status === 'idle' && !pendingApproval && !pendingUserInput && session.messages.length > 0 && (
              <span className="text-[12px] text-[var(--color-text-muted)]">
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
            <Bot className="size-10 text-[var(--color-surface-3)]" />
            <p className="text-[13px] text-[var(--color-text-muted)]">Send a message to start the conversation</p>
            <p className="text-[12px] text-[var(--color-text-muted)]">
              {isScratchpad ? (
                <>
                  Scratchpad is ready for ad-hoc questions using{' '}
                  <span className="text-[var(--color-text-secondary)]">{pattern.name}</span>
                </>
              ) : (
                <>
                  Using <span className="text-[var(--color-text-secondary)]">{pattern.name}</span> in{' '}
                  <span className="text-[var(--color-text-secondary)]">{project.name}</span>
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-4">
            {/* Branch origin banner */}
            {session.branchOrigin && (
              <BranchOriginBanner
                action={session.branchOrigin.action}
                label={branchOriginLabel}
              />
            )}
            <div className="space-y-1">
              {visibleMessages.map((message, index) => {
                const isUser = message.role === 'user';
                const isEditing = editingMessageId === message.id;
                const isLastAssistant = index === lastAssistantIndex;
                const phase = getAssistantMessagePhase(session, message, index);
                const assistantContainerClass =
                  phase === 'thinking'
                    ? 'border-[var(--color-accent-sky)]/20 bg-[var(--color-accent-sky)]/5'
                    : phase === 'final'
                      ? 'border-[var(--color-status-success)]/20 bg-[var(--color-status-success)]/5'
                      : 'border-[var(--color-border)] bg-[var(--color-surface-1)]/40';
                const assistantBadgeClass =
                  phase === 'thinking'
                    ? 'border-[var(--color-accent-sky)]/20 bg-[var(--color-accent-sky)]/10 text-[var(--color-accent-sky)]'
                    : 'border-[var(--color-status-success)]/20 bg-[var(--color-status-success)]/10 text-[var(--color-status-success)]';
                const phaseLabel =
                  phase === 'thinking' ? 'Thinking' : phase === 'final' ? 'Final' : undefined;
                const showActions = !isSessionBusy && !message.pending;
                const showThinkingBefore = isLastAssistant && thinkingMessages.length > 0;

                return (
                  <div key={message.id}>
                    {showThinkingBefore && (
                      <div className="py-2">
                        <ThinkingProcess
                          messages={thinkingMessages}
                          isActive={isSessionBusy}
                          turnStartedAt={turnStartedAt}
                        />
                      </div>
                    )}
                    <div className="message-enter group py-3" data-message-id={message.id}>
                      <div className="flex gap-3">
                        <div
                          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                            isUser ? 'brand-gradient-bg text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
                            <span>{message.authorName}</span>
                            {message.isPinned && (
                              <Bookmark className="size-3 fill-[var(--color-accent-sky)] text-[var(--color-accent-sky)]" />
                            )}
                            {!isUser && phaseLabel && (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${assistantBadgeClass}`}
                              >
                                {phaseLabel}
                              </span>
                            )}
                            {showActions && (
                              <div className="ml-auto">
                                <MessageActions
                                  message={message}
                                  isLastAssistant={isLastAssistant}
                                  onCopy={() => handleCopyMessage(message.content)}
                                  onPin={() => onPinMessage?.(message.id, !message.isPinned)}
                                  onBranch={() => onBranchFromMessage?.(message.id)}
                                  onRegenerate={onRegenerateMessage ? () => onRegenerateMessage(message.id) : undefined}
                                  onEdit={onEditAndResendMessage && isUser ? () => setEditingMessageId(message.id) : undefined}
                                />
                              </div>
                            )}
                          </div>

                          {/* Edit mode */}
                          {isEditing ? (
                            <MessageEditComposer
                              initialContent={message.content}
                              onSave={(content) => handleEditSave(message.id, content)}
                              onCancel={() => setEditingMessageId(undefined)}
                            />
                          ) : (
                            <div
                              className={
                                isUser
                                  ? 'text-[14px] leading-relaxed text-[var(--color-text-primary)]'
                                  : `rounded-xl border px-4 py-3 text-[14px] leading-relaxed text-[var(--color-text-primary)] ${assistantContainerClass}`
                              }
                            >
                              {/* Attachment thumbnails */}
                              {isUser && message.attachments && message.attachments.length > 0 && (
                                <div className="mb-2 flex flex-wrap gap-2">
                                  {message.attachments.map((att, attIdx) =>
                                    isImageAttachment(att) ? (
                                      <img
                                        key={attIdx}
                                        alt={getAttachmentDisplayName(att)}
                                        className="max-h-48 max-w-xs rounded-lg border border-[var(--color-border)] object-cover"
                                        src={`data:${att.mimeType};base64,${att.data}`}
                                      />
                                    ) : (
                                      <div
                                        key={attIdx}
                                        className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]"
                                      >
                                        <Paperclip className="size-3" />
                                        {getAttachmentDisplayName(att)}
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                              {!isUser && message.pending ? (
                                <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[var(--color-text-primary)]">
                                  {message.content}
                                </div>
                              ) : (
                                <MarkdownContent content={message.content} />
                              )}
                              {message.pending && message.content && (
                                <span className="mt-1 inline-block h-4 w-[2px] animate-pulse rounded-sm bg-[var(--color-accent)]" />
                              )}
                            </div>
                          )}
                          {message.pending && !message.content && <ThinkingDots />}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {thinkingMessages.length > 0 && lastAssistantIndex < 0 && (
                <div className="py-2">
                  <ThinkingProcess
                    messages={thinkingMessages}
                    isActive={isSessionBusy}
                    turnStartedAt={turnStartedAt}
                  />
                </div>
              )}
            </div>
            {activeSubagents && activeSubagents.length > 0 && (
              <div className="px-6 py-1">
                <SubagentActivityList subagents={activeSubagents} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--color-border-subtle)] px-6 py-4">
        {session.lastError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--color-status-error)]/10 px-3 py-2 text-[13px] text-[var(--color-status-error)]">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-status-error)]" />
            <span>{session.lastError}</span>
          </div>
        )}

        {configError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--color-status-error)]/10 px-3 py-2 text-[13px] text-[var(--color-status-error)]">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-status-error)]" />
            <span>{configError}</span>
          </div>
        )}

        {approvalError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--color-status-error)]/10 px-3 py-2 text-[13px] text-[var(--color-status-error)]">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-status-error)]" />
            <span>{approvalError}</span>
          </div>
        )}

        <div className="mx-auto max-w-3xl">
          {/* Pending approval banner */}
          {pendingApproval && (
            <div className="banner-slide-enter mb-3 space-y-2">
              <ApprovalBanner
                approval={pendingApproval}
                isResolving={isResolvingApproval}
                onResolve={(decision, alwaysApprove) => void handleResolveApproval(decision, alwaysApprove)}
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
                onAuthenticate={handleAuthenticateMcp}
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
              {hasToolCallApproval && onUpdateSessionApprovalSettings && hasApprovalContent && (
                <InlineApprovalPill
                  approvalTools={approvalTools}
                  disabled={isComposerDisabled}
                  effectiveAutoApproved={effectiveAutoApproved}
                  effectiveAutoApprovedCount={effectiveAutoApprovedCount}
                  isOverridden={isApprovalOverridden}
                  mcpProbingServerIds={mcpProbingServerIds}
                  onUpdate={onUpdateSessionApprovalSettings}
                  toolingSettings={toolingSettings}
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
                  <Loader2 className="size-3 animate-spin text-[var(--color-text-muted)]" />
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
              {hasToolCallApproval && onUpdateSessionApprovalSettings && hasApprovalContent && (
                <InlineApprovalPill
                  approvalTools={approvalTools}
                  disabled={isComposerDisabled}
                  effectiveAutoApproved={effectiveAutoApproved}
                  effectiveAutoApprovedCount={effectiveAutoApprovedCount}
                  isOverridden={isApprovalOverridden}
                  mcpProbingServerIds={mcpProbingServerIds}
                  onUpdate={onUpdateSessionApprovalSettings}
                  toolingSettings={toolingSettings}
                />
              )}
            </div>
          )}

          {/* Attachment preview */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pb-2">
              {pendingAttachments.map((attachment, index) => (
                <div
                  key={index}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-secondary)]"
                >
                  <Paperclip className="size-3 text-[var(--color-text-muted)]" />
                  <span className="max-w-[160px] truncate">{getAttachmentDisplayName(attachment)}</span>
                  <button
                    aria-label="Remove attachment"
                    className="ml-1 rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== index))}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] transition-all duration-200 focus-within:border-[var(--color-border-glow)] focus-within:shadow-[0_0_16px_rgba(36,92,249,0.06)]">
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
                        ? 'Steer the agent (sends immediately)...'
                        : isUpdatingSessionModelConfig
                          ? 'Saving model settings...'
                          : isPlanMode
                            ? 'Describe what to plan...'
                            : 'Message...'
              }
            >
              {/* Bottom action bar: left = shortcuts, right = buttons */}
              <div className="flex items-center justify-between px-2 pb-2">
                {/* Left: quick actions */}
                <div className="flex items-center gap-1.5">
                  {onTerminalToggle && (
                    <InlineTerminalPill
                      disabled={false}
                      isOpen={!!terminalOpen}
                      isRunning={!!terminalRunning}
                      onToggle={onTerminalToggle}
                    />
                  )}
                  {!isScratchpad && promptFiles.length > 0 && (
                    <InlinePromptPill
                      disabled={isComposerDisabled}
                      onSubmit={(content) => void onSend(content)}
                      promptFiles={promptFiles}
                    />
                  )}
                </div>

                {/* Right: attach, plan mode, send */}
                <div className="flex items-center gap-1">
                {/* Attachment picker */}
                <button
                  aria-label="Attach image"
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                  disabled={isComposerDisabled}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
                    input.multiple = true;
                    input.onchange = () => {
                      if (!input.files) return;
                      const newAttachments: ChatMessageAttachment[] = [];
                      for (const file of input.files) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const base64 = (reader.result as string).split(',')[1];
                          setPendingAttachments((prev) => [
                            ...prev,
                            { type: 'blob', data: base64, mimeType: file.type, displayName: file.name },
                          ]);
                        };
                        reader.readAsDataURL(file);
                      }
                    };
                    input.click();
                  }}
                  type="button"
                >
                  <Paperclip className="size-3.5" />
                </button>

                {/* Plan mode toggle */}
                {onSetInteractionMode && !isSessionBusy && (
                  <button
                    aria-label={isPlanMode ? 'Switch to interactive mode' : 'Switch to plan mode'}
                    aria-pressed={isPlanMode}
                    className={`flex size-8 items-center justify-center rounded-lg transition-all duration-150 ${
                      isPlanMode
                        ? 'bg-[var(--color-status-success)]/20 text-[var(--color-status-success)] hover:bg-[var(--color-status-success)]/30'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]'
                    }`}
                    disabled={isComposerDisabled}
                    onClick={() => onSetInteractionMode(isPlanMode ? 'interactive' : 'plan')}
                    type="button"
                  >
                    <ClipboardList className="size-3.5" />
                  </button>
                )}

                {/* Send / Stop / Steer button */}
                <button
                  className={`flex size-8 items-center justify-center rounded-lg transition-all duration-150 ${
                    isSessionBusy && !hasComposerContent && pendingAttachments.length === 0
                      ? 'bg-[var(--color-status-error)]/80 text-white hover:bg-[var(--color-status-error)]'
                      : canSubmitInput || pendingAttachments.length > 0
                        ? isSessionBusy
                          ? 'bg-[var(--color-status-warning)] text-white hover:brightness-110'
                          : isPlanMode
                            ? 'bg-[var(--color-status-success)] text-white hover:brightness-110'
                            : 'brand-gradient-bg text-white shadow-[0_2px_12px_rgba(36,92,249,0.25)] hover:shadow-[0_4px_20px_rgba(36,92,249,0.35)]'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
                  }`}
                  disabled={!canSubmitInput && !isSessionBusy && pendingAttachments.length === 0}
                  onClick={() => {
                    if (isSessionBusy && !hasComposerContent && pendingAttachments.length === 0) {
                      onCancelTurn?.();
                    } else {
                      composerRef.current?.submit();
                    }
                  }}
                  type="button"
                  aria-label={
                    isSessionBusy && !hasComposerContent && pendingAttachments.length === 0
                      ? 'Stop generating'
                      : isSessionBusy
                        ? 'Steer agent'
                        : isPlanMode
                          ? 'Send as plan request'
                          : 'Send message'
                  }
                >
                  {isSessionBusy && !hasComposerContent && pendingAttachments.length === 0 ? (
                    <Square className="size-3.5" fill="currentColor" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </button>
                </div>
              </div>
            </MarkdownComposer>
            {isPlanMode && !isSessionBusy && (
              <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-0.5">
                <div className="size-1.5 rounded-full bg-[var(--color-status-success)]" />
                <span className="text-[10px] font-medium text-[var(--color-status-success)]/80">
                  Plan mode — the agent will propose a plan instead of implementing
                </span>
              </div>
            )}
            {isSessionBusy && (hasComposerContent || pendingAttachments.length > 0) && (
              <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-0.5">
                <div className="size-1.5 rounded-full bg-[var(--color-status-warning)]" />
                <span className="text-[10px] font-medium text-[var(--color-status-warning)]/80">
                  Steering — your message will be injected into the current turn
                </span>
              </div>
            )}
          </div>

          {/* Session usage bar */}
          {sessionUsage && sessionUsage.tokenLimit > 0 && (
            <div className="px-1 pt-1.5">
              <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className={`h-full rounded-full transition-all ${
                      sessionUsage.currentTokens / sessionUsage.tokenLimit > 0.9
                        ? 'bg-[var(--color-status-error)]'
                        : sessionUsage.currentTokens / sessionUsage.tokenLimit > 0.7
                          ? 'bg-[var(--color-status-warning)]'
                          : 'bg-[var(--color-accent)]/60'
                    }`}
                    style={{ width: `${Math.min(100, (sessionUsage.currentTokens / sessionUsage.tokenLimit) * 100)}%` }}
                  />
                </div>
                <span className="tabular-nums">
                  {Math.round((sessionUsage.currentTokens / sessionUsage.tokenLimit) * 100)}% context
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Branch origin banner ───────────────────────────────────── */

function BranchOriginBanner({ action, label }: { action?: SessionBranchOriginAction; label?: string }) {
  const icon =
    action === 'regenerate'
      ? <RefreshCw className="size-3.5 shrink-0 text-[var(--color-accent-sky)]" />
      : <GitBranch className="size-3.5 shrink-0 text-[var(--color-accent)]" />;

  const verb =
    action === 'regenerate'
      ? 'Regenerated from'
      : action === 'edit-and-resend'
        ? 'Edited & resent from'
        : 'Branched from';

  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/60 px-3.5 py-2.5 text-[12px] text-[var(--color-text-secondary)]">
      {icon}
      <span>
        {verb}{' '}
        <span className="font-medium text-[var(--color-text-primary)]">
          {label ?? 'a previous session'}
        </span>
      </span>
    </div>
  );
}
