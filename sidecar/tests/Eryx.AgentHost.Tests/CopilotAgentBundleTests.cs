using Eryx.AgentHost.Contracts;
using Eryx.AgentHost.Services;

namespace Eryx.AgentHost.Tests;

public sealed class CopilotAgentBundleTests
{
    [Fact]
    public void ShouldDisableSessionTools_DisablesScratchpadAgents()
    {
        PatternDefinitionDto pattern = CreatePattern(
            mode: "sequential",
            CreateAgent("agent-primary", "Primary"));

        bool disabled = CopilotAgentBundle.ShouldDisableSessionTools(
            pattern,
            pattern.Agents[0],
            workspaceKind: "scratchpad");

        Assert.True(disabled);
    }

    [Fact]
    public void ShouldDisableSessionTools_DisablesOnlyHandoffEntryAgent()
    {
        PatternDefinitionDto pattern = CreatePattern(
            mode: "handoff",
            CreateAgent("agent-handoff-triage", "Triage"),
            CreateAgent("agent-handoff-runtime", "Runtime Specialist"));

        bool triageDisabled = CopilotAgentBundle.ShouldDisableSessionTools(
            pattern,
            pattern.Agents[0],
            workspaceKind: "project");
        bool specialistDisabled = CopilotAgentBundle.ShouldDisableSessionTools(
            pattern,
            pattern.Agents[1],
            workspaceKind: "project");

        Assert.True(triageDisabled);
        Assert.False(specialistDisabled);
    }

    [Fact]
    public void ShouldDisableSessionTools_LeavesNonHandoffProjectAgentsEnabled()
    {
        PatternDefinitionDto pattern = CreatePattern(
            mode: "sequential",
            CreateAgent("agent-analyst", "Analyst"),
            CreateAgent("agent-builder", "Builder"));

        bool disabled = CopilotAgentBundle.ShouldDisableSessionTools(
            pattern,
            pattern.Agents[0],
            workspaceKind: "project");

        Assert.False(disabled);
    }

    private static PatternDefinitionDto CreatePattern(string mode, params PatternAgentDefinitionDto[] agents)
    {
        return new PatternDefinitionDto
        {
            Id = $"pattern-{mode}",
            Name = mode,
            Mode = mode,
            Availability = "available",
            Agents = agents,
            Graph = PatternGraphResolver.CreateDefault(new PatternDefinitionDto
            {
                Id = $"pattern-{mode}",
                Name = mode,
                Mode = mode,
                Availability = "available",
                Agents = agents,
            }),
        };
    }

    private static PatternAgentDefinitionDto CreateAgent(string id, string name)
    {
        return new PatternAgentDefinitionDto
        {
            Id = id,
            Name = name,
            Instructions = $"You are {name}.",
            Model = "gpt-5.4",
        };
    }
}
