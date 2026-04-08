namespace Aryx.AgentHost.Contracts;

internal abstract record ProviderSessionEvent;

internal sealed record ProviderAssistantMessageDeltaEvent(string MessageId) : ProviderSessionEvent;

internal sealed record ProviderAssistantMessageEvent(
    string MessageId,
    bool HasToolRequests) : ProviderSessionEvent;

internal sealed record ProviderToolExecutionStartEvent(
    string ToolCallId,
    string ToolName,
    IReadOnlyDictionary<string, object?>? ToolArguments) : ProviderSessionEvent;

internal sealed record ProviderAssistantIntentEvent(string? Intent) : ProviderSessionEvent;

internal sealed record ProviderAssistantReasoningDeltaEvent(
    string? ReasoningId,
    string? DeltaContent) : ProviderSessionEvent;

internal sealed record ProviderSubagentStartedEvent(
    string? ToolCallId,
    string? AgentName,
    string? AgentDisplayName,
    string? AgentDescription) : ProviderSessionEvent;

internal sealed record ProviderSubagentCompletedEvent(
    string? ToolCallId,
    string? AgentName,
    string? AgentDisplayName) : ProviderSessionEvent;

internal sealed record ProviderSubagentFailedEvent(
    string? ToolCallId,
    string? AgentName,
    string? AgentDisplayName,
    string? Error) : ProviderSessionEvent;

internal sealed record ProviderSubagentSelectedEvent(
    string? AgentName,
    string? AgentDisplayName,
    IReadOnlyList<string>? Tools) : ProviderSessionEvent;

internal sealed record ProviderSubagentDeselectedEvent() : ProviderSessionEvent;

internal sealed record ProviderSkillInvokedEvent(
    string SkillName,
    string Path,
    string Content,
    IReadOnlyList<string>? AllowedTools,
    string? PluginName,
    string? PluginVersion) : ProviderSessionEvent;

internal sealed record ProviderHookStartEvent(
    string HookInvocationId,
    string HookType,
    object? Input) : ProviderSessionEvent;

internal sealed record ProviderHookEndEvent(
    string HookInvocationId,
    string HookType,
    bool? Success,
    object? Output,
    string? Error) : ProviderSessionEvent;

internal sealed record ProviderAssistantUsageEvent(
    string Model,
    double? InputTokens,
    double? OutputTokens,
    double? CacheReadTokens,
    double? CacheWriteTokens,
    double? Cost,
    double? Duration,
    double? TotalNanoAiu,
    Dictionary<string, QuotaSnapshotDto>? QuotaSnapshots) : ProviderSessionEvent;

internal sealed record ProviderSessionUsageEvent(
    double TokenLimit,
    double CurrentTokens,
    double MessagesLength,
    double? SystemTokens,
    double? ConversationTokens,
    double? ToolDefinitionsTokens,
    bool? IsInitial) : ProviderSessionEvent;

internal sealed record ProviderSessionCompactionStartEvent(
    double? SystemTokens,
    double? ConversationTokens,
    double? ToolDefinitionsTokens) : ProviderSessionEvent;

internal sealed record ProviderSessionCompactionCompleteEvent(
    bool? Success,
    string? Error,
    double? SystemTokens,
    double? ConversationTokens,
    double? ToolDefinitionsTokens,
    double? PreCompactionTokens,
    double? PostCompactionTokens,
    double? PreCompactionMessagesLength,
    double? MessagesRemoved,
    double? TokensRemoved,
    string? SummaryContent,
    double? CheckpointNumber,
    string? CheckpointPath) : ProviderSessionEvent;

internal sealed record ProviderPendingMessagesModifiedEvent() : ProviderSessionEvent;

internal sealed record ProviderMcpOauthRequiredEvent() : ProviderSessionEvent;

internal sealed record ProviderExitPlanModeRequestedEvent() : ProviderSessionEvent;
