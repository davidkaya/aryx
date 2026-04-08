using Aryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal interface IProviderTranscriptProjector
{
    ChatMessage ToChatMessage(ChatMessageDto message);

    void AttachMessageMode(IList<ChatMessage> messages, string? messageMode);

    List<ChatMessage> SelectNewOutputMessages(
        IReadOnlyList<ChatMessage> outputMessages,
        IReadOnlyList<ChatMessage> inputMessages);

    List<ChatMessageDto> ProjectCompletedMessagesFromSegments(
        RunTurnCommandDto command,
        IReadOnlyList<ChatMessage> newMessages,
        IReadOnlyList<TranscriptSegment> segments,
        AgentIdentity? fallbackAgent = null);
}
