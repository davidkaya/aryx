using System.Text;

namespace Aryx.AgentHost.Services;

internal readonly record struct TranscriptSegment(
    string MessageId,
    string AuthorName,
    string Content,
    bool IsFinalized = false)
{
    public static TranscriptSegment FromTuple((string MessageId, string AuthorName, string Content) segment)
        => new(segment.MessageId, segment.AuthorName, segment.Content);

    public void Deconstruct(out string messageId, out string authorName, out string content)
    {
        messageId = MessageId;
        authorName = AuthorName;
        content = Content;
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
        _ = TryAppendDelta(messageId, authorName, delta, out TranscriptSegment segment);
        return segment;
    }

    public bool TryAppendDelta(
        string messageId,
        string authorName,
        string delta,
        out TranscriptSegment segment)
    {
        BufferedTranscriptSegment bufferedSegment = GetOrCreateSegment(messageId, authorName);
        bool contentChanged = bufferedSegment.TryAppendDelta(authorName, delta);
        segment = bufferedSegment.ToSnapshot();
        return contentChanged;
    }

    public bool TryApplySnapshot(
        string messageId,
        string authorName,
        string content,
        out TranscriptSegment segment)
    {
        BufferedTranscriptSegment bufferedSegment = GetOrCreateSegment(messageId, authorName);
        bool visibleContentChanged = bufferedSegment.TryApplySnapshot(authorName, content);
        segment = bufferedSegment.ToSnapshot();
        return visibleContentChanged;
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

        public bool IsFinalized { get; private set; }

        public StringBuilder Content { get; } = new();

        public bool TryAppendDelta(string authorName, string delta)
        {
            SetAuthorName(authorName);
            if (IsFinalized || string.IsNullOrEmpty(delta))
            {
                return false;
            }

            string currentContent = Content.ToString();
            string mergedContent = StreamingTextMerger.Merge(currentContent, delta);
            if (string.Equals(currentContent, mergedContent, StringComparison.Ordinal))
            {
                return false;
            }

            SetContent(mergedContent);
            return true;
        }

        public bool TryApplySnapshot(string authorName, string content)
        {
            SetAuthorName(authorName);
            string normalizedContent = content ?? string.Empty;
            string currentContent = Content.ToString();
            bool visibleContentChanged = !string.Equals(currentContent, normalizedContent, StringComparison.Ordinal);

            SetContent(normalizedContent);
            IsFinalized = true;
            return visibleContentChanged;
        }

        private void SetContent(string value)
        {
            Content.Clear();
            Content.Append(value);
        }

        private void SetAuthorName(string value)
        {
            AuthorName = value;
        }

        public TranscriptSegment ToSnapshot()
        {
            return new TranscriptSegment(MessageId, AuthorName, Content.ToString(), IsFinalized);
        }
    }
}
