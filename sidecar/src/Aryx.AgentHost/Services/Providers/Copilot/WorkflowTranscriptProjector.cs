using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal static class WorkflowTranscriptProjector
{
    public static ChatMessage ToChatMessage(ChatMessageDto message)
    {
        ChatMessage mapped = new(message.Role switch
        {
            "user" => ChatRole.User,
            "system" => ChatRole.System,
            _ => ChatRole.Assistant,
        }, message.Content);

        if (!string.IsNullOrWhiteSpace(message.AuthorName))
        {
            mapped.AuthorName = message.AuthorName;
        }

        foreach (ChatMessageAttachmentDto attachment in message.Attachments)
        {
            mapped.Contents.Add(new AIContent
            {
                RawRepresentation = attachment,
            });
        }

        return mapped;
    }

    public static void AttachMessageMode(IList<ChatMessage> messages, string? messageMode)
    {
        if (messages.Count == 0 || string.IsNullOrWhiteSpace(messageMode))
        {
            return;
        }

        messages[^1].Contents.Add(new AIContent
        {
            RawRepresentation = new CopilotMessageOptionsMetadata(messageMode.Trim()),
        });
    }

    public static List<ChatMessageDto> ProjectCompletedMessages(
        RunTurnCommandDto command,
        IReadOnlyList<ChatMessage> newMessages,
        IReadOnlyList<(string MessageId, string AuthorName, string Content)> segments,
        AgentIdentity? fallbackAgent = null)
    {
        return ProjectCompletedMessagesFromSegments(
            command,
            newMessages,
            segments.Select(TranscriptSegment.FromTuple).ToList(),
            fallbackAgent);
    }

    internal static List<ChatMessageDto> ProjectCompletedMessagesFromSegments(
        RunTurnCommandDto command,
        IReadOnlyList<ChatMessage> newMessages,
        IReadOnlyList<TranscriptSegment> segments,
        AgentIdentity? fallbackAgent = null)
    {
        List<ChatMessageDto> projectedMessages = [];
        int fallbackOutputIndex = 0;
        string createdAt = DateTimeOffset.UtcNow.ToString("O");
        List<TranscriptSegment> preparedSegments = PrepareSegmentsForProjection(command.Workflow, segments);
        List<TranscriptSegment> remainingSegments = preparedSegments.ToList();
        List<ChatMessage> assistantMessages = newMessages.Where(message => message.Role != ChatRole.User).ToList();

        for (int messageIndex = 0; messageIndex < assistantMessages.Count; messageIndex++)
        {
            ChatMessage message = assistantMessages[messageIndex];
            TranscriptSegment? matchedSegment = TryMatchSegment(
                message,
                remainingSegments,
                assistantMessages.Count - messageIndex,
                command.Workflow,
                fallbackAgent);
            string content = ResolveProjectedContent(message, matchedSegment);
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            if (matchedSegment.HasValue)
            {
                remainingSegments.Remove(matchedSegment.Value);
            }

            fallbackOutputIndex++;
            projectedMessages.Add(CreateProjectedMessage(
                command,
                message,
                matchedSegment,
                fallbackAgent,
                createdAt,
                fallbackOutputIndex,
                content));
        }

        if (projectedMessages.Count == 0 && preparedSegments.Count > 0)
        {
            projectedMessages.AddRange(preparedSegments.Select(segment =>
                CreateProjectedMessageFromSegment(command, segment, createdAt)));
        }

        return projectedMessages;
    }

    private static ChatMessageDto CreateProjectedMessage(
        RunTurnCommandDto command,
        ChatMessage message,
        TranscriptSegment? matchedSegment,
        AgentIdentity? fallbackAgent,
        string createdAt,
        int fallbackOutputIndex,
        string content)
    {
        return new ChatMessageDto
        {
            Id = matchedSegment?.MessageId
                ?? message.MessageId
                ?? $"{command.RequestId}-final-{fallbackOutputIndex}",
            Role = message.Role == ChatRole.System ? "system" : "assistant",
            AuthorName = ResolveProjectedAuthorName(
                command.Workflow,
                message.AuthorName,
                matchedSegment?.AuthorName,
                fallbackAgent),
            Content = content,
            CreatedAt = createdAt,
        };
    }

    private static string ResolveProjectedContent(
        ChatMessage message,
        TranscriptSegment? matchedSegment)
    {
        if (matchedSegment is { IsFinalized: true } finalizedSegment
            && !string.IsNullOrWhiteSpace(finalizedSegment.Content))
        {
            return finalizedSegment.Content;
        }

        return FirstNonBlank(
                message.Text,
                TryGetAssistantMessageContent(message),
                matchedSegment?.Content)
            ?? string.Empty;
    }

    private static string? TryGetAssistantMessageContent(ChatMessage message)
    {
        if (TryGetAssistantMessageData(message.RawRepresentation, out AssistantMessageData? assistantMessageData))
        {
            return assistantMessageData?.Content;
        }

        foreach (AIContent content in message.Contents)
        {
            if (TryGetAssistantMessageData(content.RawRepresentation, out assistantMessageData))
            {
                return assistantMessageData?.Content;
            }
        }

        return null;
    }

    private static ChatMessageDto CreateProjectedMessageFromSegment(
        RunTurnCommandDto command,
        TranscriptSegment segment,
        string createdAt)
    {
        return new ChatMessageDto
        {
            Id = segment.MessageId,
            Role = "assistant",
            AuthorName = AgentIdentityResolver.ResolveDisplayAuthorName(command.Workflow, segment.AuthorName),
            Content = segment.Content,
            CreatedAt = createdAt,
        };
    }

    private static List<TranscriptSegment> PrepareSegmentsForProjection(
        WorkflowDefinitionDto workflow,
        IReadOnlyList<TranscriptSegment> segments)
    {
        if (!workflow.IsOrchestrationMode("concurrent")
            || segments.Count <= 1)
        {
            return segments.ToList();
        }

        // Agent Framework concurrent workflows aggregate the last message emitted by each agent.
        // Collapse streamed segments to the most recent segment per author, preserving the order
        // in which those authors most recently completed so positional fallback stays aligned.
        Dictionary<string, (TranscriptSegment Segment, int LastIndex)> latestSegmentByAuthor =
            new(StringComparer.Ordinal);

        for (int index = 0; index < segments.Count; index++)
        {
            TranscriptSegment segment = segments[index];
            string authorKey = AgentIdentityResolver.ResolveDisplayAuthorName(workflow, segment.AuthorName);
            latestSegmentByAuthor[authorKey] = (segment, index);
        }

        return latestSegmentByAuthor.Values
            .OrderBy(entry => entry.LastIndex)
            .Select(entry => entry.Segment)
            .ToList();
    }

    private static TranscriptSegment? TryMatchSegment(
        ChatMessage message,
        IReadOnlyList<TranscriptSegment> remainingSegments,
        int remainingMessageCount,
        WorkflowDefinitionDto workflow,
        AgentIdentity? fallbackAgent)
    {
        if (remainingSegments.Count == 0)
        {
            return null;
        }

        string? messageId = FirstNonBlank(message.MessageId);
        if (messageId is not null
            && TryFindSegment(
                remainingSegments,
                segment => string.Equals(segment.MessageId, messageId, StringComparison.Ordinal),
                out TranscriptSegment messageIdMatchedSegment))
        {
            return messageIdMatchedSegment;
        }

        string? messageText = string.IsNullOrWhiteSpace(message.Text) ? null : message.Text;
        if (messageText is not null)
        {
            string resolvedAuthorName = ResolveProjectedAuthorName(
                workflow,
                message.AuthorName,
                fallbackIdentifier: null,
                fallbackAgent);

            if (TryFindSegment(
                    remainingSegments,
                    segment => string.Equals(segment.Content, messageText, StringComparison.Ordinal)
                        && string.Equals(
                            AgentIdentityResolver.ResolveDisplayAuthorName(workflow, segment.AuthorName),
                            resolvedAuthorName,
                            StringComparison.Ordinal),
                    out TranscriptSegment authorMatchedSegment))
            {
                return authorMatchedSegment;
            }

            if (TryFindSegment(
                    remainingSegments,
                    segment => string.Equals(segment.Content, messageText, StringComparison.Ordinal),
                    out TranscriptSegment contentMatchedSegment))
            {
                return contentMatchedSegment;
            }
        }

        if (remainingMessageCount == 1)
        {
            if (fallbackAgent.HasValue
                && AgentIdentityResolver.IsGenericAssistantIdentifier(message.AuthorName)
                && TryFindLastSegment(
                    remainingSegments,
                    segment => string.Equals(
                        AgentIdentityResolver.ResolveDisplayAuthorName(workflow, segment.AuthorName),
                        fallbackAgent.Value.AgentName,
                        StringComparison.Ordinal),
                    out TranscriptSegment fallbackMatchedSegment))
            {
                return fallbackMatchedSegment;
            }

            return remainingSegments[^1];
        }

        return remainingSegments.Count == remainingMessageCount
            ? remainingSegments[0]
            : null;
    }

    private static bool TryFindSegment(
        IReadOnlyList<TranscriptSegment> segments,
        Func<TranscriptSegment, bool> predicate,
        out TranscriptSegment matchedSegment)
    {
        foreach (TranscriptSegment segment in segments)
        {
            if (predicate(segment))
            {
                matchedSegment = segment;
                return true;
            }
        }

        matchedSegment = default;
        return false;
    }

    private static bool TryFindLastSegment(
        IReadOnlyList<TranscriptSegment> segments,
        Func<TranscriptSegment, bool> predicate,
        out TranscriptSegment matchedSegment)
    {
        for (int index = segments.Count - 1; index >= 0; index--)
        {
            TranscriptSegment segment = segments[index];
            if (predicate(segment))
            {
                matchedSegment = segment;
                return true;
            }
        }

        matchedSegment = default;
        return false;
    }

    public static List<ChatMessage> SelectNewOutputMessages(
        IReadOnlyList<ChatMessage> outputMessages,
        IReadOnlyList<ChatMessage> inputMessages)
    {
        if (outputMessages.Count == 0)
        {
            return [];
        }

        if (inputMessages.Count == 0)
        {
            return outputMessages.ToList();
        }

        int overlapLength = FindOutputInputOverlapLength(outputMessages, inputMessages);
        return outputMessages.Skip(overlapLength).ToList();
    }

    private static int FindOutputInputOverlapLength(
        IReadOnlyList<ChatMessage> outputMessages,
        IReadOnlyList<ChatMessage> inputMessages)
    {
        int maxOverlap = Math.Min(outputMessages.Count, inputMessages.Count);

        for (int overlapLength = maxOverlap; overlapLength > 0; overlapLength--)
        {
            int inputStart = inputMessages.Count - overlapLength;
            bool matches = true;

            for (int index = 0; index < overlapLength; index++)
            {
                if (!ChatMessagesMatch(inputMessages[inputStart + index], outputMessages[index]))
                {
                    matches = false;
                    break;
                }
            }

            if (matches)
            {
                return overlapLength;
            }
        }

        return 0;
    }

    private static bool ChatMessagesMatch(ChatMessage inputMessage, ChatMessage outputMessage)
    {
        if (inputMessage.Role != outputMessage.Role)
        {
            return false;
        }

        if (!string.Equals(inputMessage.Text, outputMessage.Text, StringComparison.Ordinal))
        {
            return false;
        }

        return string.IsNullOrWhiteSpace(inputMessage.AuthorName)
            || string.IsNullOrWhiteSpace(outputMessage.AuthorName)
            || string.Equals(inputMessage.AuthorName, outputMessage.AuthorName, StringComparison.Ordinal);
    }

    private static string ResolveProjectedAuthorName(
        WorkflowDefinitionDto workflow,
        string? primaryIdentifier,
        string? fallbackIdentifier,
        AgentIdentity? fallbackAgent)
    {
        if (fallbackAgent.HasValue && AgentIdentityResolver.IsGenericAssistantIdentifier(primaryIdentifier))
        {
            return fallbackAgent.Value.AgentName;
        }

        if (fallbackAgent.HasValue
            && string.IsNullOrWhiteSpace(primaryIdentifier)
            && string.IsNullOrWhiteSpace(fallbackIdentifier))
        {
            return fallbackAgent.Value.AgentName;
        }

        IReadOnlyList<WorkflowNodeDto> agentNodes = workflow.GetAgentNodes();
        if (agentNodes.Count == 1
            && string.IsNullOrWhiteSpace(primaryIdentifier)
            && string.IsNullOrWhiteSpace(fallbackIdentifier))
        {
            WorkflowNodeDto singleAgent = agentNodes[0];
            return AgentIdentityResolver.ResolveDisplayAuthorName(workflow, singleAgent.GetAgentId(), singleAgent.GetAgentName());
        }

        return AgentIdentityResolver.ResolveDisplayAuthorName(
            workflow,
            primaryIdentifier,
            fallbackIdentifier);
    }

    private static bool TryGetAssistantMessageData(
        object? rawRepresentation,
        out AssistantMessageData? assistantMessageData)
    {
        switch (rawRepresentation)
        {
            case AssistantMessageEvent assistantMessage when !string.IsNullOrWhiteSpace(assistantMessage.Data.Content):
                assistantMessageData = assistantMessage.Data;
                return true;
            case AssistantMessageData data when !string.IsNullOrWhiteSpace(data.Content):
                assistantMessageData = data;
                return true;
            default:
                assistantMessageData = null;
                return false;
        }
    }

    private static string? FirstNonBlank(params string?[] values)
    {
        foreach (string? value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }
}
