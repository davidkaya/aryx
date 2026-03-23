using System.Text.RegularExpressions;

namespace Eryx.AgentHost.Services;

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

        return AppendWithNaturalBoundary(current, incoming);
    }

    private static string AppendWithNaturalBoundary(string current, string incoming)
    {
        if (ShouldInsertNewlineBoundary(current, incoming))
        {
            return current + "\n" + incoming;
        }

        if (ShouldInsertSpaceBoundary(current, incoming))
        {
            return current + " " + incoming;
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

        HashSet<string> currentTokens = Tokenize(current).ToHashSet(StringComparer.Ordinal);
        HashSet<string> incomingTokens = Tokenize(incoming).ToHashSet(StringComparer.Ordinal);
        if (currentTokens.Count < 3 || incomingTokens.Count < 3)
        {
            return false;
        }

        int shared = incomingTokens.Count(token => currentTokens.Contains(token));
        return shared / (double)Math.Min(currentTokens.Count, incomingTokens.Count) >= 0.5;
    }

    private static bool ShouldInsertNewlineBoundary(string current, string incoming)
    {
        if (current.EndsWith('\n'))
        {
            return false;
        }

        return MarkdownBlockPrefixRegex().IsMatch(incoming.TrimStart());
    }

    private static bool ShouldInsertSpaceBoundary(string current, string incoming)
    {
        char lastChar = current[^1];
        char firstChar = incoming[0];

        if (char.IsWhiteSpace(lastChar)
            || char.IsWhiteSpace(firstChar)
            || "([{/\"'`".Contains(lastChar))
        {
            return false;
        }

        if (ClosingPunctuationRegex().IsMatch(incoming))
        {
            return false;
        }

        if (MarkdownInlinePrefixRegex().IsMatch(incoming)
            || char.IsUpper(firstChar)
            || char.IsDigit(firstChar))
        {
            return true;
        }

        string[] currentTokens = Tokenize(current).ToArray();
        string[] incomingTokens = Tokenize(incoming).ToArray();
        string firstIncomingToken = incomingTokens.FirstOrDefault() ?? string.Empty;

        return currentTokens.Length >= 2
            && incomingTokens.Length >= 2
            && firstIncomingToken.Length >= 2;
    }

    private static IEnumerable<string> Tokenize(string value)
    {
        return TokenRegex()
            .Matches(value.ToLowerInvariant())
            .Select(match => match.Value)
            .Where(token => token.Length > 0);
    }

    [GeneratedRegex("[a-z0-9]+", RegexOptions.IgnoreCase)]
    private static partial Regex TokenRegex();

    [GeneratedRegex(@"^[.,!?;:%)\]}]")]
    private static partial Regex ClosingPunctuationRegex();

    [GeneratedRegex(@"^[*_`~\[]")]
    private static partial Regex MarkdownInlinePrefixRegex();

    [GeneratedRegex(@"^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)", RegexOptions.Singleline)]
    private static partial Regex MarkdownBlockPrefixRegex();
}
