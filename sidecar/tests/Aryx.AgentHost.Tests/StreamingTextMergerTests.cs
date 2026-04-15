using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class StreamingTextMergerTests
{
    [Fact]
    public void Merge_AppendsPlainDeltas()
    {
        Assert.Equal("I am going", StreamingTextMerger.Merge("I am", " going"));
    }

    [Fact]
    public void Merge_ReplacesWithGrowingSnapshot()
    {
        Assert.Equal("I am going", StreamingTextMerger.Merge("I am", "I am going"));
    }

    [Fact]
    public void Merge_PreservesCurrentTextForDuplicateSubset()
    {
        Assert.Equal("I am going", StreamingTextMerger.Merge("I am going", "going"));
    }

    [Fact]
    public void Merge_UsesOverlapToAvoidDuplicateJoins()
    {
        Assert.Equal("Hello world", StreamingTextMerger.Merge("Hello wor", "world"));
    }

    [Fact]
    public void Merge_ReplacesWithRevisedSnapshotWhenMostTokensOverlap()
    {
        const string current = "I mirror the existing button pattern and add brief toggle docs.";
        const string incoming = "I found the standalone component pattern and I am updating toggle docs next.";

        Assert.Equal(incoming, StreamingTextMerger.Merge(current, incoming));
    }

    [Theory]
    [InlineData("requires all wr", "itable fields", "requires all writable fields")]
    [InlineData("becomes frag", "ile for clients", "becomes fragile for clients")]
    [InlineData("Endpoint (domain) uniqu", "eness across tenants", "Endpoint (domain) uniqueness across tenants")]
    [InlineData("The doc says \"wildc", "ards are allowed\"", "The doc says \"wildcards are allowed\"")]
    [InlineData("What wildcard syntax supported (*.cont", "oso.com? contoso.* ?)", "What wildcard syntax supported (*.contoso.com? contoso.* ?)")]
    [InlineData("How does Pur", "view match traffic", "How does Purview match traffic")]
    [InlineData("more M", "DA properties", "more MDA properties")]
    [InlineData("does UA", "G normalize them?", "does UAG normalize them?")]
    public void Merge_DoesNotInjectSpacesIntoSplitWords(string current, string incoming, string expected)
    {
        Assert.Equal(expected, StreamingTextMerger.Merge(current, incoming));
    }

    [Fact]
    public void Merge_PreservesWhitespaceAlreadyPresentInDelta()
    {
        Assert.Equal(
            "How about The **Ashen Crown** feels",
            StreamingTextMerger.Merge("How about", " The **Ashen Crown** feels"));
        Assert.Equal(
            "The **Ashen Crown** feels classic and timeless.",
            StreamingTextMerger.Merge("The **Ashen Crown** feels", " classic and timeless."));
    }

    [Fact]
    public void Merge_PreservesNewlineAlreadyPresentInDelta()
    {
        Assert.Equal(
            "If you want, I can also give you\n- darker titles",
            StreamingTextMerger.Merge("If you want, I can also give you", "\n- darker titles"));
    }
}
