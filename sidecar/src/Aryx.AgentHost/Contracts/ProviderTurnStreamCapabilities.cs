namespace Aryx.AgentHost.Contracts;

internal sealed record ProviderTurnStreamCapabilities
{
    public static ProviderTurnStreamCapabilities None { get; } = new();

    public bool SupportsIntent { get; init; }

    public bool SupportsReasoningDelta { get; init; }

    public bool SupportsReasoningBlock { get; init; }

    public bool SupportsToolExecutionProgress { get; init; }

    public bool SupportsToolExecutionPartialResult { get; init; }

    public bool SupportsToolExecutionCompletion { get; init; }

    public bool SupportsSubagentLifecycle { get; init; }

    public bool SupportsHookLifecycle { get; init; }

    public bool SupportsSessionCompaction { get; init; }

    public bool SupportsPendingMessagesMutation { get; init; }

    public bool SupportsSessionTurnBoundaries { get; init; }
}
