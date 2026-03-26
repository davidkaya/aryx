using System.Collections.Concurrent;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotUserInputCoordinator
{
    private readonly ConcurrentDictionary<string, PendingUserInputRequest> _pendingUserInputs = new(StringComparer.Ordinal);

    public Task ResolveUserInputAsync(
        ResolveUserInputCommandDto command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        string userInputId = RequireUserInputId(command.UserInputId);
        PendingUserInputRequest pending = GetPendingUserInput(userInputId);
        UserInputResponse response = new()
        {
            Answer = command.Answer ?? string.Empty,
            WasFreeform = command.WasFreeform,
        };

        if (!pending.Response.TrySetResult(response))
        {
            throw new InvalidOperationException($"User input request \"{userInputId}\" is no longer pending.");
        }

        return Task.CompletedTask;
    }

    public async Task<UserInputResponse> RequestUserInputAsync(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        UserInputRequest request,
        UserInputInvocation invocation,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(agent);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(invocation);
        ArgumentNullException.ThrowIfNull(onUserInput);

        PendingUserInputRequest pending = CreatePendingUserInput(command);
        if (!_pendingUserInputs.TryAdd(pending.UserInputId, pending))
        {
            throw new InvalidOperationException($"User input request \"{pending.UserInputId}\" is already pending.");
        }

        try
        {
            await onUserInput(BuildUserInputRequestedEvent(command, agent, request, pending.UserInputId))
                .ConfigureAwait(false);

            using CancellationTokenRegistration registration = cancellationToken.Register(
                static state =>
                {
                    ((TaskCompletionSource<UserInputResponse>)state!)
                        .TrySetCanceled();
                },
                pending.Response);

            return await pending.Response.Task.ConfigureAwait(false);
        }
        finally
        {
            _pendingUserInputs.TryRemove(pending.UserInputId, out _);
        }
    }

    internal static UserInputRequestedEventDto BuildUserInputRequestedEvent(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        UserInputRequest request,
        string userInputId)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(agent);
        ArgumentNullException.ThrowIfNull(request);

        string? normalizedAgentId = NormalizeOptionalString(agent.Id);
        string? normalizedAgentName = NormalizeOptionalString(agent.Name) ?? normalizedAgentId;

        return new UserInputRequestedEventDto
        {
            Type = "user-input-requested",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            UserInputId = userInputId,
            AgentId = normalizedAgentId,
            AgentName = normalizedAgentName,
            Question = NormalizeOptionalString(request.Question) ?? string.Empty,
            Choices = NormalizeOptionalStringList(request.Choices ?? []),
            AllowFreeform = request.AllowFreeform,
        };
    }

    private static PendingUserInputRequest CreatePendingUserInput(RunTurnCommandDto command)
    {
        return new PendingUserInputRequest(
            command.RequestId,
            command.SessionId,
            CreateUserInputRequestId(),
            new TaskCompletionSource<UserInputResponse>(TaskCreationOptions.RunContinuationsAsynchronously));
    }

    private PendingUserInputRequest GetPendingUserInput(string userInputId)
    {
        if (_pendingUserInputs.TryGetValue(userInputId, out PendingUserInputRequest? pending))
        {
            return pending;
        }

        throw new InvalidOperationException($"User input request \"{userInputId}\" is not pending.");
    }

    private static string RequireUserInputId(string? userInputId)
    {
        string? normalizedUserInputId = NormalizeOptionalString(userInputId);
        return normalizedUserInputId
            ?? throw new InvalidOperationException("User input ID is required.");
    }

    private static string CreateUserInputRequestId()
    {
        return $"user-input-{Guid.NewGuid():N}";
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

    private sealed record PendingUserInputRequest(
        string RequestId,
        string SessionId,
        string UserInputId,
        TaskCompletionSource<UserInputResponse> Response);
}
