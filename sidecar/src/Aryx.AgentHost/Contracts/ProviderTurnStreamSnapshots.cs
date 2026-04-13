namespace Aryx.AgentHost.Contracts;

internal enum ProviderToolExecutionStatus
{
    Running,
    Completed,
    Failed,
}

internal sealed record ProviderToolExecutionSnapshot
{
    public string ToolCallId { get; init; } = string.Empty;

    public string? ToolName { get; init; }

    public IReadOnlyDictionary<string, object?>? ToolArguments { get; init; }

    public ProviderToolExecutionStatus Status { get; init; }

    public string? LatestProgressMessage { get; init; }

    public string PartialOutput { get; init; } = string.Empty;

    public string? ResultContent { get; init; }

    public string? DetailedResultContent { get; init; }

    public string? Error { get; init; }
}

internal sealed record ProviderReasoningSnapshot
{
    public string ReasoningId { get; init; } = string.Empty;

    public string Content { get; init; } = string.Empty;

    public bool IsComplete { get; init; }
}
