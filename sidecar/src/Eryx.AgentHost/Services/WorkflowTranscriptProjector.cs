using System.Text;
using Eryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

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

        return mapped;
    }

    public static List<ChatMessageDto> ProjectCompletedMessages(
        RunTurnCommandDto command,
        IReadOnlyList<ChatMessage> newMessages,
        IReadOnlyList<(string MessageId, string AuthorName, string Content)> segments,
        AgentIdentity? fallbackAgent = null)
    {
        List<ChatMessageDto> mapped = [];
        int fallbackOutputIndex = 0;
        string createdAt = DateTimeOffset.UtcNow.ToString("O");
        List<(string MessageId, string AuthorName, string Content)> preparedSegments =
            PrepareSegmentsForProjection(command.Pattern, segments);
        List<(string MessageId, string AuthorName, string Content)> remainingSegments = preparedSegments.ToList();
        List<ChatMessage> assistantMessages = newMessages.Where(message => message.Role != ChatRole.User).ToList();

        for (int messageIndex = 0; messageIndex < assistantMessages.Count; messageIndex++)
        {
            ChatMessage message = assistantMessages[messageIndex];
            (string MessageId, string AuthorName, string Content)? segment = TryMatchSegment(
                message,
                remainingSegments,
                assistantMessages.Count - messageIndex,
                command.Pattern,
                fallbackAgent);
            string content = message.Text ?? segment?.Content ?? string.Empty;
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            if (segment.HasValue)
            {
                remainingSegments.Remove(segment.Value);
            }

            fallbackOutputIndex++;

            mapped.Add(new ChatMessageDto
            {
                Id = segment?.MessageId ?? $"{command.RequestId}-final-{fallbackOutputIndex}",
                Role = message.Role == ChatRole.System ? "system" : "assistant",
                AuthorName = ResolveProjectedAuthorName(
                    command.Pattern,
                    message.AuthorName,
                    segment?.AuthorName,
                    fallbackAgent),
                Content = content,
                CreatedAt = createdAt,
            });
        }

        if (mapped.Count == 0 && preparedSegments.Count > 0)
        {
            mapped.AddRange(preparedSegments.Select(segment => new ChatMessageDto
            {
                Id = segment.MessageId,
                Role = "assistant",
                AuthorName = AgentIdentityResolver.ResolveDisplayAuthorName(command.Pattern, segment.AuthorName),
                Content = segment.Content,
                CreatedAt = createdAt,
            }));
        }

        return mapped;
    }

    private static List<(string MessageId, string AuthorName, string Content)> PrepareSegmentsForProjection(
        PatternDefinitionDto pattern,
        IReadOnlyList<(string MessageId, string AuthorName, string Content)> segments)
    {
        if (!string.Equals(pattern.Mode, "concurrent", StringComparison.Ordinal)
            || segments.Count <= 1)
        {
            return segments.ToList();
        }

        // Agent Framework concurrent workflows aggregate the last message emitted by each agent.
        // Collapse streamed segments to the most recent segment per author, preserving the order
        // in which those authors most recently completed so positional fallback stays aligned.
        Dictionary<string, ((string MessageId, string AuthorName, string Content) Segment, int LastIndex)> latestSegmentByAuthor =
            new(StringComparer.Ordinal);

        for (int index = 0; index < segments.Count; index++)
        {
            (string MessageId, string AuthorName, string Content) segment = segments[index];
            string authorKey = AgentIdentityResolver.ResolveDisplayAuthorName(pattern, segment.AuthorName);
            latestSegmentByAuthor[authorKey] = (segment, index);
        }

        return latestSegmentByAuthor.Values
            .OrderBy(entry => entry.LastIndex)
            .Select(entry => entry.Segment)
            .ToList();
    }

    private static (string MessageId, string AuthorName, string Content)? TryMatchSegment(
        ChatMessage message,
        IReadOnlyList<(string MessageId, string AuthorName, string Content)> remainingSegments,
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
                    out (string MessageId, string AuthorName, string Content) authorMatchedSegment))
            {
                return authorMatchedSegment;
            }

            if (TryFindSegment(
                    remainingSegments,
                    segment => string.Equals(segment.Content, messageText, StringComparison.Ordinal),
                    out (string MessageId, string AuthorName, string Content) contentMatchedSegment))
            {
                return contentMatchedSegment;
            }
        }

        return remainingSegments.Count == remainingMessageCount
            ? remainingSegments[0]
            : null;
    }

    private static bool TryFindSegment(
        IReadOnlyList<(string MessageId, string AuthorName, string Content)> segments,
        Func<(string MessageId, string AuthorName, string Content), bool> predicate,
        out (string MessageId, string AuthorName, string Content) matchedSegment)
    {
        foreach ((string MessageId, string AuthorName, string Content) segment in segments)
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

        return AgentIdentityResolver.ResolveDisplayAuthorName(
            pattern,
            primaryIdentifier,
            fallbackIdentifier);
    }
}

internal sealed class StreamingTranscriptBuffer
{
    private readonly List<StreamingSegment> _segments = [];

    public int Count => _segments.Count;

    public (string MessageId, string AuthorName, string Content) AppendDelta(
        string messageId,
        string authorName,
        string delta)
    {
        StreamingSegment segment = GetOrCreateSegment(messageId, authorName);
        segment.SetContent(StreamingTextMerger.Merge(segment.Content.ToString(), delta));
        segment.SetAuthorName(authorName);
        return segment.ToSnapshot();
    }

    public IReadOnlyList<(string MessageId, string AuthorName, string Content)> Snapshot()
    {
        return _segments.Select(segment => segment.ToSnapshot()).ToList();
    }

    private StreamingSegment GetOrCreateSegment(string messageId, string authorName)
    {
        StreamingSegment? existing = _segments.LastOrDefault(segment => segment.MessageId == messageId);
        if (existing is not null)
        {
            return existing;
        }

        StreamingSegment created = new(messageId, authorName);
        _segments.Add(created);
        return created;
    }

    private sealed class StreamingSegment
    {
        public StreamingSegment(string messageId, string authorName)
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

        public (string MessageId, string AuthorName, string Content) ToSnapshot()
        {
            return (MessageId, AuthorName, Content.ToString());
        }
    }
}
