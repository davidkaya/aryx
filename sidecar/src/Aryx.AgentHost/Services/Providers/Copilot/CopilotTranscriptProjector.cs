using Aryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotTranscriptProjector : IProviderTranscriptProjector
{
    public static CopilotTranscriptProjector Instance { get; } = new();

    private CopilotTranscriptProjector()
    {
    }

    public ChatMessage ToChatMessage(ChatMessageDto message)
        => WorkflowTranscriptProjector.ToChatMessage(message);

    public void AttachMessageMode(IList<ChatMessage> messages, string? messageMode)
        => WorkflowTranscriptProjector.AttachMessageMode(messages, messageMode);

    public List<ChatMessage> SelectNewOutputMessages(
        IReadOnlyList<ChatMessage> outputMessages,
        IReadOnlyList<ChatMessage> inputMessages)
        => WorkflowTranscriptProjector.SelectNewOutputMessages(outputMessages, inputMessages);

    public List<ChatMessageDto> ProjectCompletedMessagesFromSegments(
        RunTurnCommandDto command,
        IReadOnlyList<ChatMessage> newMessages,
        IReadOnlyList<TranscriptSegment> segments,
        AgentIdentity? fallbackAgent = null)
        => WorkflowTranscriptProjector.ProjectCompletedMessagesFromSegments(
            command,
            newMessages,
            segments,
            fallbackAgent);
}
