using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public interface ITurnWorkflowRunner
{
    Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<AgentActivityEventDto, Task> onActivity,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        CancellationToken cancellationToken);

    Task ResolveApprovalAsync(
        ResolveApprovalCommandDto command,
        CancellationToken cancellationToken);
}
