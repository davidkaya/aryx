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

    [Fact]
    public void TryResolveKnownAgentIdentity_ResolvesReferencedSubworkflowAgentWithContext()
    {
        WorkflowDefinitionDto nestedWorkflow = CreateWorkflow(
            "nested-review-workflow",
            [
                CreateAgent("agent-reviewer", "Reviewer"),
            ],
            orchestrationMode: "single");
        WorkflowDefinitionDto workflow = CreateWorkflow(
            "parent-workflow",
            [
                CreateSubworkflow("subworkflow-review", "Review Lane", workflowId: nestedWorkflow.Id),
            ],
            orchestrationMode: "single");

        bool resolved = AgentIdentityResolver.TryResolveKnownAgentIdentity(
            workflow,
            [nestedWorkflow],
            "Reviewer_agent_reviewer",
            out AgentIdentity agent);

        Assert.True(resolved);
        Assert.Equal("agent-reviewer", agent.AgentId);
        Assert.Equal("Reviewer", agent.AgentName);
        Assert.Equal("subworkflow-review", agent.Subworkflow?.SubworkflowNodeId);
        Assert.Equal("Review Lane", agent.Subworkflow?.SubworkflowName);
    }

    [Fact]
    public void BuildAgentSubworkflowIndex_UsesImmediateNestedSubworkflowContext()
    {
        WorkflowDefinitionDto innerWorkflow = CreateWorkflow(
            "inner-workflow",
            [
                CreateAgent("agent-inner-reviewer", "Inner Reviewer"),
            ],
            orchestrationMode: "single");
        WorkflowDefinitionDto outerWorkflow = CreateWorkflow(
            "outer-workflow",
            [
                CreateSubworkflow("subworkflow-inner", "Inner Review", inlineWorkflow: innerWorkflow),
            ],
            orchestrationMode: "single");
        WorkflowDefinitionDto workflow = CreateWorkflow(
            "parent-workflow",
            [
                CreateSubworkflow("subworkflow-outer", "Outer Review", inlineWorkflow: outerWorkflow),
            ],
            orchestrationMode: "single");

        IReadOnlyDictionary<string, SubworkflowContext> index =
            AgentIdentityResolver.BuildAgentSubworkflowIndex(workflow);

        Assert.True(index.TryGetValue("agent-inner-reviewer", out SubworkflowContext subworkflow));
        Assert.Equal("subworkflow-inner", subworkflow.SubworkflowNodeId);
        Assert.Equal("Inner Review", subworkflow.SubworkflowName);
    }

    [Fact]
    public void BuildAgentSubworkflowIndex_SkipsUnresolvableSubWorkflowReferences()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
            "parent-workflow",
            [
                CreateAgent("agent-top-level", "Top Level"),
                CreateSubworkflow("subworkflow-missing", "Missing Pipeline", workflowId: "nonexistent-workflow"),
            ],
            orchestrationMode: "concurrent");

        IReadOnlyDictionary<string, SubworkflowContext> index =
            AgentIdentityResolver.BuildAgentSubworkflowIndex(workflow);

        Assert.Empty(index);
    }

    private static WorkflowDefinitionDto CreateWorkflow(
        IReadOnlyList<WorkflowNodeDto> nodes,
        string orchestrationMode = "concurrent")
    {
        return CreateWorkflow($"{orchestrationMode}-workflow", nodes, orchestrationMode);
    }

    private static WorkflowDefinitionDto CreateWorkflow(
        string id,
        IReadOnlyList<WorkflowNodeDto> nodes,
        string orchestrationMode = "concurrent")
    {
        return new WorkflowDefinitionDto
        {
            Id = id,
            Name = "Workflow",
            Graph = new WorkflowGraphDto
            {
                Nodes =
                [
                    .. nodes,
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

    private static WorkflowNodeDto CreateSubworkflow(
        string id,
        string label,
        string? workflowId = null,
        WorkflowDefinitionDto? inlineWorkflow = null)
    {
        return new WorkflowNodeDto
        {
            Id = id,
            Kind = "sub-workflow",
            Label = label,
            Config = new WorkflowNodeConfigDto
            {
                Kind = "sub-workflow",
                WorkflowId = workflowId,
                InlineWorkflow = inlineWorkflow,
            },
        };
    }
}
