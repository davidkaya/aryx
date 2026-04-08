using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal interface IProviderTurnSupport
{
    Task<ProviderAgentBundle> CreateAgentBundleAsync(
        RunTurnCommandDto command,
        TurnExecutionState state,
        Func<SidecarEventDto, Task> onEvent,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        CancellationTokenSource runCancellation,
        CancellationToken cancellationToken);

    Task ResolveApprovalAsync(
        ResolveApprovalCommandDto command,
        CancellationToken cancellationToken);

    Task ResolveUserInputAsync(
        ResolveUserInputCommandDto command,
        CancellationToken cancellationToken);

    Task<UserInputResponse> RequestRequestPortUserInputAsync(
        RunTurnCommandDto command,
        UserInputRequest request,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        CancellationToken cancellationToken);

    ExitPlanModeRequestedEventDto? ConsumePendingExitPlanModeRequest(string requestId);

    void ClearRequestState(string requestId);
}
