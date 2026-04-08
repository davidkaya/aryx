using Aryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotTurnExecutionState : TurnExecutionState
{
    public CopilotTurnExecutionState(RunTurnCommandDto command)
        : base(command)
    {
    }

    public void UpdateCompletedMessages(
        IReadOnlyList<ChatMessage> allMessages,
        IReadOnlyList<ChatMessage> inputMessages)
    {
        base.UpdateCompletedMessages(allMessages, inputMessages, CopilotTranscriptProjector.Instance);
    }

    public IReadOnlyList<ChatMessageDto> FinalizeCompletedMessages()
    {
        return base.FinalizeCompletedMessages(CopilotTranscriptProjector.Instance);
    }
}
