using System.Text;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal readonly record struct TranscriptSegment(string MessageId, string AuthorName, string Content)
{
    public static TranscriptSegment FromTuple((string MessageId, string AuthorName, string Content) segment)
        => new(segment.MessageId, segment.AuthorName, segment.Content);
}

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
        List<TranscriptSegment> preparedSegments = PrepareSegmentsForProjection(command.Pattern, segments);
        List<TranscriptSegment> remainingSegments = preparedSegments.ToList();
        List<ChatMessage> assistantMessages = newMessages.Where(message => message.Role != ChatRole.User).ToList();

        for (int messageIndex = 0; messageIndex < assistantMessages.Count; messageIndex++)
        {
            ChatMessage message = assistantMessages[messageIndex];
            TranscriptSegment? matchedSegment = TryMatchSegment(
                message,
                remainingSegments,
                assistantMessages.Count - messageIndex,
                command.Pattern,
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
                command.Pattern,
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
        return FirstNonBlank(
                message.Text,
                matchedSegment?.Content,
                TryGetAssistantMessageContent(message))
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
            AuthorName = AgentIdentityResolver.ResolveDisplayAuthorName(command.Pattern, segment.AuthorName),
            Content = segment.Content,
            CreatedAt = createdAt,
        };
    }

    private static List<TranscriptSegment> PrepareSegmentsForProjection(
        PatternDefinitionDto pattern,
        IReadOnlyList<TranscriptSegment> segments)
    {
        if (!string.Equals(pattern.Mode, "concurrent", StringComparison.Ordinal)
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
            string authorKey = AgentIdentityResolver.ResolveDisplayAuthorName(pattern, segment.AuthorName);
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
        PatternDefinitionDto pattern,
        AgentIdentity? fallbackAgent)
    {
        if (remainingSegments.Count == 0)
        {
            return null;
        }

        string? messageText = string.IsNullOrWhiteSpace(message.Text) ? null : message.Text;
        if (messageText is not null)
        {
            string resolvedAuthorName = ResolveProjectedAuthorName(
                pattern,
                message.AuthorName,
                fallbackIdentifier: null,
                fallbackAgent);

            if (TryFindSegment(
                    remainingSegments,
                    segment => string.Equals(segment.Content, messageText, StringComparison.Ordinal)
                        && string.Equals(
                            AgentIdentityResolver.ResolveDisplayAuthorName(pattern, segment.AuthorName),
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
                        AgentIdentityResolver.ResolveDisplayAuthorName(pattern, segment.AuthorName),
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
        PatternDefinitionDto pattern,
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

        if (pattern.Agents.Count == 1
            && string.IsNullOrWhiteSpace(primaryIdentifier)
            && string.IsNullOrWhiteSpace(fallbackIdentifier))
        {
            PatternAgentDefinitionDto singleAgent = pattern.Agents[0];
            return AgentIdentityResolver.ResolveDisplayAuthorName(pattern, singleAgent.Id, singleAgent.Name);
        }

        return AgentIdentityResolver.ResolveDisplayAuthorName(
            pattern,
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

internal sealed class StreamingTranscriptBuffer
{
    private readonly List<BufferedTranscriptSegment> _segments = [];

    public int Count => _segments.Count;

    public TranscriptSegment AppendDelta(
        string messageId,
        string authorName,
        string delta)
    {
        BufferedTranscriptSegment segment = GetOrCreateSegment(messageId, authorName);
        segment.SetContent(StreamingTextMerger.Merge(segment.Content.ToString(), delta));
        segment.SetAuthorName(authorName);
        return segment.ToSnapshot();
    }

    public IReadOnlyList<TranscriptSegment> Snapshot()
    {
        return _segments.Select(segment => segment.ToSnapshot()).ToList();
    }

    private BufferedTranscriptSegment GetOrCreateSegment(string messageId, string authorName)
    {
        BufferedTranscriptSegment? existing = _segments.LastOrDefault(segment => segment.MessageId == messageId);
        if (existing is not null)
        {
            return existing;
        }

        BufferedTranscriptSegment created = new(messageId, authorName);
        _segments.Add(created);
        return created;
    }

    private sealed class BufferedTranscriptSegment
    {
        public BufferedTranscriptSegment(string messageId, string authorName)
        {
            MessageId = messageId;
            AuthorName = authorName;
        }

        public string MessageId { get; }

        public string AuthorName { get; private set; }

        public StringBuilder Content { get; } = new();

        public void SetContent(string value)
        {
            Content.Clear();
            Content.Append(value);
        }

        public void SetAuthorName(string value)
        {
            AuthorName = value;
        }

        public TranscriptSegment ToSnapshot()
        {
            return new TranscriptSegment(MessageId, AuthorName, Content.ToString());
        }
    }
}
