using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class AgentIdentityResolverTests
{
    [Fact]
    public void TryResolveKnownAgentIdentity_MatchesRuntimeExecutorIdentifier()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
        [
            CreateAgent("agent-concurrent-architect", "Architect"),
            CreateAgent("agent-concurrent-product", "Product"),
        ]);

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            workflow,
            "Architect_agent_concurrent_architect",
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-concurrent-architect", agent.AgentId);
        Assert.Equal("Architect", agent.AgentName);
    }

    [Fact]
    public void TryResolveKnownAgentIdentity_MatchesSanitizedNameAndId()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
        [
            CreateAgent("agent-single-primary", "Primary Agent"),
        ],
        orchestrationMode: "single");

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            workflow,
            "Primary_Agent_agent_single_primary",
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-single-primary", agent.AgentId);
        Assert.Equal("Primary Agent", agent.AgentName);
    }

    [Fact]
    public void TryResolveKnownAgentIdentity_MapsAssistantToSingleAgent()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
        [
            CreateAgent("agent-single-primary", "Primary Agent"),
        ],
        orchestrationMode: "single");

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            workflow,
            "assistant",
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-single-primary", agent.AgentId);
        Assert.Equal("Primary Agent", agent.AgentName);
    }

    [Fact]
    public void TryResolveKnownAgentIdentity_DoesNotGuessAssistantForMultiAgentWorkflow()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
        [
            CreateAgent("agent-concurrent-architect", "Architect"),
            CreateAgent("agent-concurrent-product", "Product"),
        ]);

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            workflow,
            "assistant",
            out _);

        Assert.False(resolved);
    }

    [Fact]
    public void ResolveDisplayAuthorName_UsesCanonicalAgentName()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
        [
            CreateAgent("agent-concurrent-implementer", "Implementer"),
        ],
        orchestrationMode: "single");

        string authorName = AgentIdentityResolver.ResolveDisplayAuthorName(
            workflow,
            "Implementer_agent_concurrent_implementer");

        Assert.Equal("Implementer", authorName);
    }

    [Fact]
    public void TryResolveObservedAgentIdentity_UsesFallbackAgentForGenericAssistant()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
        [
            CreateAgent("agent-handoff-ux", "UX Specialist"),
            CreateAgent("agent-handoff-runtime", "Runtime Specialist"),
        ]);

        bool resolved = AgentIdentityResolver.TryResolveObservedAgentIdentity(
            workflow,
            "assistant",
            new AgentIdentity("agent-handoff-ux", "UX Specialist"),
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-handoff-ux", agent.AgentId);
        Assert.Equal("UX Specialist", agent.AgentName);
    }

    private static WorkflowDefinitionDto CreateWorkflow(
        IReadOnlyList<WorkflowNodeDto> agents,
        string orchestrationMode = "concurrent")
    {
        return new WorkflowDefinitionDto
        {
            Id = $"{orchestrationMode}-workflow",
            Name = "Workflow",
            Graph = new WorkflowGraphDto
            {
                Nodes =
                [
                    .. agents,
                ],
            },
            Settings = new WorkflowSettingsDto
            {
                OrchestrationMode = orchestrationMode,
            },
        };
    }

    private static WorkflowNodeDto CreateAgent(string id, string name)
    {
        return new WorkflowNodeDto
        {
            Id = id,
            Kind = "agent",
            Label = name,
            Config = new WorkflowNodeConfigDto
            {
                Kind = "agent",
                Id = id,
                Name = name,
                Model = "gpt-5.4",
                Instructions = "Help with the request.",
            },
        };
    }
}
