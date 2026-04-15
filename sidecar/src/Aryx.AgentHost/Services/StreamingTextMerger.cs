namespace Aryx.AgentHost.Services;

internal static partial class StreamingTextMerger
{
    private const double SnapshotReplacementMinLengthRatio = 0.6;
    private const int SnapshotReplacementMinTokenCount = 3;
    private const double SnapshotReplacementSharedTokenRatio = 0.5;

    public static string Merge(string current, string incoming)
    {
        if (string.IsNullOrEmpty(current))
        {
            return incoming;
        }

        if (string.IsNullOrEmpty(incoming))
        {
            return current;
        }

        if (TryMergeSnapshotVariants(current, incoming, out string merged)
            || TryMergeByOverlap(current, incoming, out merged))
        {
            return merged;
        }

        if (ShouldReplaceWithSnapshot(current, incoming))
        {
            return incoming;
        }

        return current + incoming;
    }

    private static int ComputeSuffixPrefixOverlap(string current, string incoming)
    {
        int maxOverlap = Math.Min(current.Length, incoming.Length);
        for (int length = maxOverlap; length > 0; length--)
        {
            if (string.CompareOrdinal(current, current.Length - length, incoming, 0, length) == 0)
            {
                return length;
            }
        }

        return 0;
    }

    private static bool ShouldReplaceWithSnapshot(string current, string incoming)
    {
        if (!HasViableSnapshotLength(current, incoming))
        {
            return false;
        }

        HashSet<string> currentTokens = Tokenize(current).ToHashSet(StringComparer.Ordinal);
        HashSet<string> incomingTokens = Tokenize(incoming).ToHashSet(StringComparer.Ordinal);
        if (!HasEnoughTokensForSnapshotComparison(currentTokens, incomingTokens))
        {
            return false;
        }

        int sharedTokenCount = incomingTokens.Count(token => currentTokens.Contains(token));
        double sharedTokenRatio = sharedTokenCount / (double)Math.Min(currentTokens.Count, incomingTokens.Count);
        return sharedTokenRatio >= SnapshotReplacementSharedTokenRatio;
    }

    private static bool HasViableSnapshotLength(string current, string incoming)
    {
        return incoming.Length >= Math.Floor(current.Length * SnapshotReplacementMinLengthRatio);
    }

    private static bool HasEnoughTokensForSnapshotComparison(
        HashSet<string> currentTokens,
        HashSet<string> incomingTokens)
    {
        return currentTokens.Count >= SnapshotReplacementMinTokenCount
            && incomingTokens.Count >= SnapshotReplacementMinTokenCount;
    }

    private static IEnumerable<string> Tokenize(string value)
    {
        return TokenRegex()
            .Matches(value.ToLowerInvariant())
            .Select(match => match.Value)
            .Where(token => token.Length > 0);
    }

    private static bool TryMergeSnapshotVariants(string current, string incoming, out string merged)
    {
        if (incoming.StartsWith(current, StringComparison.Ordinal)
            || incoming.Contains(current, StringComparison.Ordinal))
        {
            merged = incoming;
            return true;
        }

        if (current.Contains(incoming, StringComparison.Ordinal))
        {
            merged = current;
            return true;
        }

        merged = string.Empty;
        return false;
    }

    private static bool TryMergeByOverlap(string current, string incoming, out string merged)
    {
        int overlapLength = ComputeSuffixPrefixOverlap(current, incoming);
        if (overlapLength == 0)
        {
            merged = string.Empty;
            return false;
        }

        merged = current + incoming[overlapLength..];
        return true;
    }

    [System.Text.RegularExpressions.GeneratedRegex("[a-z0-9]+", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex TokenRegex();
}
