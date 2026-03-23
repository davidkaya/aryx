using Eryx.AgentHost.Services;

namespace Eryx.AgentHost.Tests;

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

    [Fact]
    public void Merge_InsertsWhitespaceWhenSnapshotLikeUpdatesWouldOtherwiseGlueWordsTogether()
    {
        Assert.Equal(
            "How about The **Ashen Crown** feels",
            StreamingTextMerger.Merge("How about", "The **Ashen Crown** feels"));
        Assert.Equal(
            "The **Ashen Crown** feels classic and timeless.",
            StreamingTextMerger.Merge("The **Ashen Crown** feels", "classic and timeless."));
    }

    [Fact]
    public void Merge_InsertsNewlineBeforeStreamedMarkdownBlockMarkers()
    {
        Assert.Equal(
            "If you want, I can also give you\n- darker titles",
            StreamingTextMerger.Merge("If you want, I can also give you", "- darker titles"));
    }
}
