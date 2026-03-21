using Kopaya.AgentHost.Contracts;
using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class AgentIdentityResolverTests
{
    [Fact]
    public void TryResolveKnownAgentIdentity_MatchesRuntimeExecutorIdentifier()
    {
        PatternDefinitionDto pattern = CreatePattern(
        [
            CreateAgent(id: "agent-concurrent-architect", name: "Architect"),
            CreateAgent(id: "agent-concurrent-product", name: "Product"),
        ]);

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            pattern,
            "Architect_agent_concurrent_architect",
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-concurrent-architect", agent.AgentId);
        Assert.Equal("Architect", agent.AgentName);
    }

    [Fact]
    public void TryResolveKnownAgentIdentity_MatchesSanitizedNameAndId()
    {
        PatternDefinitionDto pattern = CreatePattern(
        [
            CreateAgent(id: "agent-single-primary", name: "Primary Agent"),
        ],
        mode: "single");

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            pattern,
            "Primary_Agent_agent_single_primary",
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-single-primary", agent.AgentId);
        Assert.Equal("Primary Agent", agent.AgentName);
    }

    [Fact]
    public void TryResolveKnownAgentIdentity_MapsAssistantToSingleAgent()
    {
        PatternDefinitionDto pattern = CreatePattern(
        [
            CreateAgent(id: "agent-single-primary", name: "Primary Agent"),
        ],
        mode: "single");

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            pattern,
            "assistant",
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-single-primary", agent.AgentId);
        Assert.Equal("Primary Agent", agent.AgentName);
    }

    [Fact]
    public void TryResolveKnownAgentIdentity_DoesNotGuessAssistantForMultiAgentPattern()
    {
        PatternDefinitionDto pattern = CreatePattern(
        [
            CreateAgent(id: "agent-concurrent-architect", name: "Architect"),
            CreateAgent(id: "agent-concurrent-product", name: "Product"),
        ]);

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            pattern,
            "assistant",
            out _);

        Assert.False(resolved);
    }

    [Fact]
    public void ResolveDisplayAuthorName_UsesCanonicalAgentName()
    {
        PatternDefinitionDto pattern = CreatePattern(
        [
            CreateAgent(id: "agent-concurrent-implementer", name: "Implementer"),
        ],
        mode: "single");

        string authorName = AgentIdentityResolver.ResolveDisplayAuthorName(
            pattern,
            "Implementer_agent_concurrent_implementer");

        Assert.Equal("Implementer", authorName);
    }

    [Fact]
    public void TryResolveObservedAgentIdentity_UsesFallbackAgentForGenericAssistant()
    {
        PatternDefinitionDto pattern = CreatePattern(
        [
            CreateAgent(id: "agent-handoff-ux", name: "UX Specialist"),
            CreateAgent(id: "agent-handoff-runtime", name: "Runtime Specialist"),
        ]);

        bool resolved = AgentIdentityResolver.TryResolveObservedAgentIdentity(
            pattern,
            "assistant",
            new AgentIdentity("agent-handoff-ux", "UX Specialist"),
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-handoff-ux", agent.AgentId);
        Assert.Equal("UX Specialist", agent.AgentName);
    }

    private static PatternDefinitionDto CreatePattern(
        IReadOnlyList<PatternAgentDefinitionDto> agents,
        string mode = "concurrent")
    {
        return new PatternDefinitionDto
        {
            Id = $"{mode}-pattern",
            Name = "Pattern",
            Mode = mode,
            Availability = "available",
            Agents = agents,
        };
    }

    private static PatternAgentDefinitionDto CreateAgent(string id, string name)
    {
        return new PatternAgentDefinitionDto
        {
            Id = id,
            Name = name,
            Model = "gpt-5.4",
            Instructions = "Help with the request.",
        };
    }
}
