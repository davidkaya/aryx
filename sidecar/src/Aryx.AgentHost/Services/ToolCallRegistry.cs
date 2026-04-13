using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal sealed class ToolCallRegistry
{
    private readonly ConcurrentDictionary<string, ProviderToolExecutionSnapshot> _toolExecutionsByCallId = new(StringComparer.Ordinal);

    public bool TryGetExecution(string? toolCallId, [NotNullWhen(true)] out ProviderToolExecutionSnapshot? snapshot)
    {
        snapshot = null;
        return !string.IsNullOrWhiteSpace(toolCallId)
            && _toolExecutionsByCallId.TryGetValue(toolCallId, out snapshot);
    }

    public bool TryGetToolName(string? toolCallId, [NotNullWhen(true)] out string? toolName)
    {
        toolName = null;
        return TryGetExecution(toolCallId, out ProviderToolExecutionSnapshot? snapshot)
            && !string.IsNullOrWhiteSpace(snapshot.ToolName)
            && (toolName = snapshot.ToolName) is not null;
    }

    public bool HasTrackedArguments(string? toolCallId)
    {
        return TryGetExecution(toolCallId, out ProviderToolExecutionSnapshot? snapshot)
            && snapshot.ToolArguments is { Count: > 0 };
    }

    public void RecordToolStart(
        string toolCallId,
        string toolName,
        IReadOnlyDictionary<string, object?>? toolArguments)
    {
        _toolExecutionsByCallId.AddOrUpdate(
            toolCallId,
            static (id, state) => new ProviderToolExecutionSnapshot
            {
                ToolCallId = id,
                ToolName = state.ToolName,
                ToolArguments = state.ToolArguments,
                Status = ProviderToolExecutionStatus.Running,
            },
            static (_, existing, state) => existing with
            {
                ToolName = state.ToolName,
                ToolArguments = state.ToolArguments,
                Status = ProviderToolExecutionStatus.Running,
            },
            (ToolName: toolName, ToolArguments: toolArguments));
    }

    public bool TryRecordToolRequest(
        string? toolCallId,
        string toolName,
        IReadOnlyDictionary<string, object?>? toolArguments)
    {
        bool hasToolArguments = toolArguments is { Count: > 0 };
        string? normalizedToolCallId = NormalizeOptionalString(toolCallId);
        if (normalizedToolCallId is null)
        {
            return true;
        }

        if (_toolExecutionsByCallId.TryGetValue(normalizedToolCallId, out ProviderToolExecutionSnapshot? existing))
        {
            bool trackedHasArguments = existing.ToolArguments is { Count: > 0 };
            if (trackedHasArguments || !hasToolArguments)
            {
                return false;
            }
        }

        _toolExecutionsByCallId.AddOrUpdate(
            normalizedToolCallId,
            id => new ProviderToolExecutionSnapshot
            {
                ToolCallId = id,
                ToolName = toolName,
                ToolArguments = toolArguments,
                Status = ProviderToolExecutionStatus.Running,
            },
            (_, existing) => existing with
            {
                ToolName = toolName,
                ToolArguments = toolArguments,
                Status = existing.Status is ProviderToolExecutionStatus.Completed or ProviderToolExecutionStatus.Failed
                    ? existing.Status
                    : ProviderToolExecutionStatus.Running,
            });
        return true;
    }

    public void RecordProgress(string toolCallId, string? progressMessage)
    {
        string? normalizedProgress = NormalizeOptionalString(progressMessage);
        _toolExecutionsByCallId.AddOrUpdate(
            toolCallId,
            id => new ProviderToolExecutionSnapshot
            {
                ToolCallId = id,
                Status = ProviderToolExecutionStatus.Running,
                LatestProgressMessage = normalizedProgress,
            },
            (_, existing) => existing with
            {
                Status = existing.Status is ProviderToolExecutionStatus.Completed or ProviderToolExecutionStatus.Failed
                    ? existing.Status
                    : ProviderToolExecutionStatus.Running,
                LatestProgressMessage = normalizedProgress ?? existing.LatestProgressMessage,
            });
    }

    public void RecordPartialResult(string toolCallId, string? partialOutput)
    {
        if (string.IsNullOrEmpty(partialOutput))
        {
            return;
        }

        _toolExecutionsByCallId.AddOrUpdate(
            toolCallId,
            id => new ProviderToolExecutionSnapshot
            {
                ToolCallId = id,
                Status = ProviderToolExecutionStatus.Running,
                PartialOutput = partialOutput,
            },
            (_, existing) => existing with
            {
                Status = existing.Status is ProviderToolExecutionStatus.Completed or ProviderToolExecutionStatus.Failed
                    ? existing.Status
                    : ProviderToolExecutionStatus.Running,
                PartialOutput = string.Concat(existing.PartialOutput, partialOutput),
            });
    }

    public void RecordCompletion(ProviderToolExecutionCompleteEvent toolExecution)
    {
        _toolExecutionsByCallId.AddOrUpdate(
            toolExecution.ToolCallId,
            id => new ProviderToolExecutionSnapshot
            {
                ToolCallId = id,
                Status = toolExecution.Success ? ProviderToolExecutionStatus.Completed : ProviderToolExecutionStatus.Failed,
                ResultContent = toolExecution.ResultContent,
                DetailedResultContent = toolExecution.DetailedResultContent,
                Error = toolExecution.Error,
            },
            (_, existing) => existing with
            {
                Status = toolExecution.Success ? ProviderToolExecutionStatus.Completed : ProviderToolExecutionStatus.Failed,
                ResultContent = toolExecution.ResultContent ?? existing.ResultContent,
                DetailedResultContent = toolExecution.DetailedResultContent ?? existing.DetailedResultContent,
                Error = toolExecution.Error ?? existing.Error,
            });
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
