using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotEventAdapter : IProviderEventAdapter
{
    public ProviderTurnStreamCapabilities Capabilities { get; } = new()
    {
        SupportsIntent = true,
        SupportsReasoningDelta = true,
        SupportsReasoningBlock = true,
        SupportsToolExecutionProgress = true,
        SupportsToolExecutionPartialResult = true,
        SupportsToolExecutionCompletion = true,
        SupportsSubagentLifecycle = true,
        SupportsHookLifecycle = true,
        SupportsSessionCompaction = true,
        SupportsPendingMessagesMutation = true,
        SupportsSessionTurnBoundaries = true,
    };

    public ProviderSessionEvent? TryAdapt(object rawEvent)
    {
        return rawEvent switch
        {
            AssistantMessageDeltaEvent messageDelta
                when NormalizeRequiredString(messageDelta.Data?.MessageId) is { } messageId =>
                new ProviderAssistantMessageDeltaEvent(messageId, messageDelta.Data?.DeltaContent),

            AssistantMessageEvent assistantMessage
                when NormalizeRequiredString(assistantMessage.Data?.MessageId) is { } messageId =>
                new ProviderAssistantMessageEvent(
                    messageId,
                    assistantMessage.Data?.Content,
                    assistantMessage.Data?.ToolRequests is { Length: > 0 }),

            ToolExecutionStartEvent toolExecutionStart
                when NormalizeRequiredString(toolExecutionStart.Data?.ToolCallId) is { } toolCallId
                    && NormalizeRequiredString(toolExecutionStart.Data?.ToolName) is { } toolName =>
                new ProviderToolExecutionStartEvent(
                    toolCallId,
                    toolName,
                    WorkflowRequestInfoInterpreter.NormalizeRawToolArguments(toolExecutionStart.Data?.Arguments)),

            ToolExecutionProgressEvent toolExecutionProgress
                when NormalizeRequiredString(toolExecutionProgress.Data?.ToolCallId) is { } toolCallId =>
                new ProviderToolExecutionProgressEvent(
                    toolCallId,
                    NormalizeOptionalString(toolExecutionProgress.Data?.ProgressMessage)),

            ToolExecutionPartialResultEvent toolExecutionPartialResult
                when NormalizeRequiredString(toolExecutionPartialResult.Data?.ToolCallId) is { } toolCallId =>
                new ProviderToolExecutionPartialResultEvent(
                    toolCallId,
                    toolExecutionPartialResult.Data?.PartialOutput),

            ToolExecutionCompleteEvent toolExecutionComplete
                when NormalizeRequiredString(toolExecutionComplete.Data?.ToolCallId) is { } toolCallId =>
                new ProviderToolExecutionCompleteEvent(
                    toolCallId,
                    toolExecutionComplete.Data?.Success ?? false,
                    NormalizeOptionalString(toolExecutionComplete.Data?.Result?.Content),
                    NormalizeOptionalString(toolExecutionComplete.Data?.Result?.DetailedContent),
                    NormalizeOptionalString(toolExecutionComplete.Data?.Error?.Message)),

            AssistantIntentEvent intentEvent =>
                new ProviderAssistantIntentEvent(NormalizeOptionalString(intentEvent.Data?.Intent)),

            AssistantReasoningDeltaEvent reasoningDelta =>
                new ProviderAssistantReasoningDeltaEvent(
                    NormalizeOptionalString(reasoningDelta.Data?.ReasoningId),
                    reasoningDelta.Data?.DeltaContent),

            AssistantReasoningEvent reasoning =>
                new ProviderAssistantReasoningEvent(
                    NormalizeOptionalString(reasoning.Data?.ReasoningId),
                    reasoning.Data?.Content),

            AssistantTurnStartEvent turnStart =>
                new ProviderAssistantTurnStartEvent(NormalizeOptionalString(turnStart.Data?.TurnId)),

            AssistantTurnEndEvent turnEnd =>
                new ProviderAssistantTurnEndEvent(NormalizeOptionalString(turnEnd.Data?.TurnId)),

            SubagentStartedEvent started =>
                new ProviderSubagentStartedEvent(
                    started.Data?.ToolCallId,
                    started.Data?.AgentName,
                    started.Data?.AgentDisplayName,
                    started.Data?.AgentDescription),

            SubagentCompletedEvent completed =>
                new ProviderSubagentCompletedEvent(
                    completed.Data?.ToolCallId,
                    completed.Data?.AgentName,
                    completed.Data?.AgentDisplayName),

            SubagentFailedEvent failed =>
                new ProviderSubagentFailedEvent(
                    failed.Data?.ToolCallId,
                    failed.Data?.AgentName,
                    failed.Data?.AgentDisplayName,
                    failed.Data?.Error),

            SubagentSelectedEvent selected =>
                new ProviderSubagentSelectedEvent(
                    selected.Data?.AgentName,
                    selected.Data?.AgentDisplayName,
                    selected.Data?.Tools),

            SubagentDeselectedEvent =>
                new ProviderSubagentDeselectedEvent(),

            SkillInvokedEvent skillInvoked =>
                new ProviderSkillInvokedEvent(
                    skillInvoked.Data?.Name ?? string.Empty,
                    skillInvoked.Data?.Path ?? string.Empty,
                    skillInvoked.Data?.Content ?? string.Empty,
                    skillInvoked.Data?.AllowedTools,
                    skillInvoked.Data?.PluginName,
                    skillInvoked.Data?.PluginVersion),

            HookStartEvent hookStart =>
                new ProviderHookStartEvent(
                    hookStart.Data?.HookInvocationId ?? string.Empty,
                    hookStart.Data?.HookType ?? string.Empty,
                    hookStart.Data?.Input),

            HookEndEvent hookEnd =>
                new ProviderHookEndEvent(
                    hookEnd.Data?.HookInvocationId ?? string.Empty,
                    hookEnd.Data?.HookType ?? string.Empty,
                    hookEnd.Data?.Success,
                    hookEnd.Data?.Output,
                    hookEnd.Data?.Error?.Message),

            AssistantUsageEvent assistantUsage =>
                new ProviderAssistantUsageEvent(
                    assistantUsage.Data?.Model ?? string.Empty,
                    assistantUsage.Data?.InputTokens,
                    assistantUsage.Data?.OutputTokens,
                    assistantUsage.Data?.CacheReadTokens,
                    assistantUsage.Data?.CacheWriteTokens,
                    assistantUsage.Data?.Cost,
                    assistantUsage.Data?.Duration,
                    assistantUsage.Data?.CopilotUsage?.TotalNanoAiu,
                    QuotaSnapshotMapper.MapOrNull(assistantUsage.Data?.QuotaSnapshots)),

            SessionUsageInfoEvent usageInfo =>
                new ProviderSessionUsageEvent(
                    usageInfo.Data?.TokenLimit ?? 0,
                    usageInfo.Data?.CurrentTokens ?? 0,
                    usageInfo.Data?.MessagesLength ?? 0,
                    usageInfo.Data?.SystemTokens,
                    usageInfo.Data?.ConversationTokens,
                    usageInfo.Data?.ToolDefinitionsTokens,
                    usageInfo.Data?.IsInitial),

            SessionCompactionStartEvent compactionStart =>
                new ProviderSessionCompactionStartEvent(
                    compactionStart.Data?.SystemTokens,
                    compactionStart.Data?.ConversationTokens,
                    compactionStart.Data?.ToolDefinitionsTokens),

            SessionCompactionCompleteEvent compactionComplete =>
                new ProviderSessionCompactionCompleteEvent(
                    compactionComplete.Data?.Success,
                    compactionComplete.Data?.Error,
                    compactionComplete.Data?.SystemTokens,
                    compactionComplete.Data?.ConversationTokens,
                    compactionComplete.Data?.ToolDefinitionsTokens,
                    compactionComplete.Data?.PreCompactionTokens,
                    compactionComplete.Data?.PostCompactionTokens,
                    compactionComplete.Data?.PreCompactionMessagesLength,
                    compactionComplete.Data?.MessagesRemoved,
                    compactionComplete.Data?.TokensRemoved,
                    compactionComplete.Data?.SummaryContent,
                    compactionComplete.Data?.CheckpointNumber,
                    compactionComplete.Data?.CheckpointPath),

            PendingMessagesModifiedEvent =>
                new ProviderPendingMessagesModifiedEvent(),

            McpOauthRequiredEvent =>
                new ProviderMcpOauthRequiredEvent(),

            ExitPlanModeRequestedEvent =>
                new ProviderExitPlanModeRequestedEvent(),

            _ => null,
        };
    }

    private static string? NormalizeRequiredString(string? value)
    {
        string? normalized = NormalizeOptionalString(value);
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
