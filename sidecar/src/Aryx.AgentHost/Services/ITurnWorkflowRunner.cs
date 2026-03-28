using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public interface ITurnWorkflowRunner
{
    Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<SidecarEventDto, Task> onEvent,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        Func<McpOauthRequiredEventDto, Task> onMcpOAuthRequired,
        Func<ExitPlanModeRequestedEventDto, Task> onExitPlanMode,
        CancellationToken cancellationToken);

    Task ResolveApprovalAsync(
        ResolveApprovalCommandDto command,
        CancellationToken cancellationToken);

    Task ResolveUserInputAsync(
        ResolveUserInputCommandDto command,
        CancellationToken cancellationToken);
}
