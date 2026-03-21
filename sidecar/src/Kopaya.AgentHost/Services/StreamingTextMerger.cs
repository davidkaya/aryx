using System.Text.RegularExpressions;

namespace Kopaya.AgentHost.Services;

internal static partial class StreamingTextMerger
{
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

        if (incoming.StartsWith(current, StringComparison.Ordinal)
            || incoming.Contains(current, StringComparison.Ordinal))
        {
            return incoming;
        }

        if (current.Contains(incoming, StringComparison.Ordinal))
        {
            return current;
        }

        int overlap = ComputeSuffixPrefixOverlap(current, incoming);
        if (overlap > 0)
        {
            return current + incoming[overlap..];
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
        if (incoming.Length < Math.Floor(current.Length * 0.6))
        {
            return false;
        }

        HashSet<string> currentTokens = Tokenize(current);
        HashSet<string> incomingTokens = Tokenize(incoming);
        if (currentTokens.Count < 3 || incomingTokens.Count < 3)
        {
            return false;
        }

        int shared = incomingTokens.Count(token => currentTokens.Contains(token));
        return shared / (double)Math.Min(currentTokens.Count, incomingTokens.Count) >= 0.5;
    }

    private static HashSet<string> Tokenize(string value)
    {
        return TokenRegex()
            .Matches(value.ToLowerInvariant())
            .Select(match => match.Value)
            .Where(token => token.Length > 0)
            .ToHashSet(StringComparer.Ordinal);
    }

    [GeneratedRegex("[a-z0-9]+", RegexOptions.IgnoreCase)]
    private static partial Regex TokenRegex();
}
