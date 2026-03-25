using System.Text.RegularExpressions;

namespace Eryx.AgentHost.Services;

internal static partial class StreamingTextMerger
{
    private const double SnapshotReplacementMinLengthRatio = 0.6;
    private const int SnapshotReplacementMinTokenCount = 3;
    private const double SnapshotReplacementSharedTokenRatio = 0.5;
    private const string CharactersThatDoNotNeedLeadingSpace = "([{/\"'`";

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

        return current + ResolveBoundarySeparator(current, incoming) + incoming;
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

    private static string ResolveBoundarySeparator(string current, string incoming)
    {
        if (ShouldInsertNewlineBoundary(current, incoming))
        {
            return "\n";
        }

        return ShouldInsertSpaceBoundary(current, incoming)
            ? " "
            : string.Empty;
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

    private static bool ShouldInsertNewlineBoundary(string current, string incoming)
    {
        return !current.EndsWith('\n')
            && MarkdownBlockPrefixRegex().IsMatch(incoming.TrimStart());
    }

    private static bool ShouldInsertSpaceBoundary(string current, string incoming)
    {
        char lastCharacter = current[^1];
        char firstCharacter = incoming[0];
        if (HasExistingBoundary(lastCharacter, firstCharacter)
            || CharactersThatDoNotNeedLeadingSpace.Contains(lastCharacter))
        {
            return false;
        }

        if (ClosingPunctuationRegex().IsMatch(incoming))
        {
            return false;
        }

        return StartsLikeASeparatedInlineFragment(firstCharacter, incoming)
            || LooksLikeWordBoundary(current, incoming);
    }

    private static bool HasExistingBoundary(char lastCharacter, char firstCharacter)
    {
        return char.IsWhiteSpace(lastCharacter) || char.IsWhiteSpace(firstCharacter);
    }

    private static bool StartsLikeASeparatedInlineFragment(char firstCharacter, string incoming)
    {
        return MarkdownInlinePrefixRegex().IsMatch(incoming)
            || char.IsUpper(firstCharacter)
            || char.IsDigit(firstCharacter);
    }

    private static bool LooksLikeWordBoundary(string current, string incoming)
    {
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
