using Kopaya.AgentHost.Contracts;

namespace Kopaya.AgentHost.Services;

public interface ITurnWorkflowRunner
{
    Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<AgentActivityEventDto, Task> onActivity,
        CancellationToken cancellationToken);
}
