using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

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
}
