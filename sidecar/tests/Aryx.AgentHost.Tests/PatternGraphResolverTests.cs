using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class PatternGraphResolverTests
{
    [Fact]
    public void ResolveOrderedAgentIds_UsesSequentialGraphPath()
    {
        PatternDefinitionDto pattern = CreatePattern(
            "sequential",
            [
                CreateAgent("agent-1", "Analyst"),
                CreateAgent("agent-2", "Builder"),
                CreateAgent("agent-3", "Reviewer"),
            ],
            new PatternGraphDto
            {
                Nodes =
                [
                    CreateSystemNode("system-user-input", "user-input"),
                    CreateAgentNode("agent-1", 0),
                    CreateAgentNode("agent-2", 1),
                    CreateAgentNode("agent-3", 2),
                    CreateSystemNode("system-user-output", "user-output"),
                ],
                Edges =
                [
                    CreateEdge("system-user-input", "agent-node-agent-3"),
                    CreateEdge("agent-node-agent-3", "agent-node-agent-1"),
                    CreateEdge("agent-node-agent-1", "agent-node-agent-2"),
                    CreateEdge("agent-node-agent-2", "system-user-output"),
                ],
            });

        IReadOnlyList<string> orderedAgentIds = PatternGraphResolver.ResolveOrderedAgentIds(pattern);

        Assert.Equal(["agent-3", "agent-1", "agent-2"], orderedAgentIds);
    }

    [Fact]
    public void ResolveHandoff_UsesExplicitEntryAndRoutes()
    {
        PatternDefinitionDto pattern = CreatePattern(
            "handoff",
            [
                CreateAgent("agent-1", "Triage"),
                CreateAgent("agent-2", "UX"),
                CreateAgent("agent-3", "Runtime"),
            ],
            new PatternGraphDto
            {
                Nodes =
                [
                    CreateSystemNode("system-user-input", "user-input"),
                    CreateSystemNode("system-user-output", "user-output"),
                    CreateAgentNode("agent-1", 0),
                    CreateAgentNode("agent-2", 1),
                    CreateAgentNode("agent-3", 2),
                ],
                Edges =
                [
                    CreateEdge("system-user-input", "agent-node-agent-3"),
                    CreateEdge("agent-node-agent-3", "agent-node-agent-2"),
                    CreateEdge("agent-node-agent-2", "agent-node-agent-1"),
                    CreateEdge("agent-node-agent-2", "system-user-output"),
                ],
            });

        PatternHandoffTopology topology = PatternGraphResolver.ResolveHandoff(pattern);

        Assert.Equal("agent-3", topology.EntryAgentId);
        Assert.Contains(new PatternHandoffRoute("agent-3", "agent-2"), topology.Routes);
        Assert.Contains(new PatternHandoffRoute("agent-2", "agent-1"), topology.Routes);
        Assert.DoesNotContain(new PatternHandoffRoute("agent-1", "agent-2"), topology.Routes);
    }

    private static PatternDefinitionDto CreatePattern(
        string mode,
        IReadOnlyList<PatternAgentDefinitionDto> agents,
        PatternGraphDto graph)
        => new()
        {
            Id = $"{mode}-pattern",
            Name = "Pattern",
            Mode = mode,
            Availability = "available",
            Agents = agents,
            Graph = graph,
        };

    private static PatternAgentDefinitionDto CreateAgent(string id, string name)
        => new()
        {
            Id = id,
            Name = name,
            Model = "gpt-5.4",
            Instructions = "Help with the user's request.",
        };

    private static PatternGraphNodeDto CreateSystemNode(string id, string kind)
        => new()
        {
            Id = id,
            Kind = kind,
            Position = new PatternGraphPositionDto(),
        };

    private static PatternGraphNodeDto CreateAgentNode(string agentId, int order)
        => new()
        {
            Id = $"agent-node-{agentId}",
            Kind = "agent",
            AgentId = agentId,
            Order = order,
            Position = new PatternGraphPositionDto(),
        };

    private static PatternGraphEdgeDto CreateEdge(string source, string target)
        => new()
        {
            Id = $"edge-{source}-to-{target}",
            Source = source,
            Target = target,
        };
}
