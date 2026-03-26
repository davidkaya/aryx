using System.Collections.Concurrent;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotExitPlanModeCoordinator
{
    private readonly ConcurrentDictionary<string, ExitPlanModeRequestedEventDto> _pendingExitPlanRequests =
        new(StringComparer.Ordinal);

    public ExitPlanModeRequestedEventDto RecordExitPlanModeRequest(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        ExitPlanModeRequestedEvent request)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(agent);
        ArgumentNullException.ThrowIfNull(request);

        ExitPlanModeRequestedEventDto exitPlanEvent = BuildExitPlanModeRequestedEvent(command, agent, request);
        _pendingExitPlanRequests[command.RequestId] = exitPlanEvent;
        return exitPlanEvent;
    }

    public ExitPlanModeRequestedEventDto? ConsumePendingRequest(string turnRequestId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(turnRequestId);
        return _pendingExitPlanRequests.TryRemove(turnRequestId, out ExitPlanModeRequestedEventDto? pending)
            ? pending
            : null;
    }

    internal static ExitPlanModeRequestedEventDto BuildExitPlanModeRequestedEvent(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        ExitPlanModeRequestedEvent request)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(agent);
        ArgumentNullException.ThrowIfNull(request);

        ExitPlanModeRequestedData requestData = request.Data
            ?? throw new InvalidOperationException("Exit plan mode request data is required.");

        string exitPlanId = NormalizeOptionalString(requestData.RequestId)
            ?? throw new InvalidOperationException("Exit plan mode request ID is required.");
        string? normalizedAgentId = NormalizeOptionalString(agent.Id);
        string? normalizedAgentName = NormalizeOptionalString(agent.Name) ?? normalizedAgentId;

        return new ExitPlanModeRequestedEventDto
        {
            Type = "exit-plan-mode-requested",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ExitPlanId = exitPlanId,
            AgentId = normalizedAgentId,
            AgentName = normalizedAgentName,
            Summary = NormalizeOptionalString(requestData.Summary) ?? string.Empty,
            PlanContent = NormalizeOptionalString(requestData.PlanContent) ?? string.Empty,
            Actions = NormalizeOptionalStringList(requestData.Actions ?? []),
            RecommendedAction = NormalizeOptionalString(requestData.RecommendedAction),
        };
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static IReadOnlyList<string>? NormalizeOptionalStringList(IEnumerable<string?> values)
    {
        List<string> normalized = values
            .Select(NormalizeOptionalString)
            .Where(static value => value is not null)
            .Cast<string>()
            .ToList();

        return normalized.Count > 0 ? normalized : null;
    }
}
