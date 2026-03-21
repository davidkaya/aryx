using Kopaya.AgentHost.Contracts;
using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class AgentInstructionComposerTests
{
    [Fact]
    public void Compose_LeavesNonHandoffInstructionsUnchanged()
    {
        PatternDefinitionDto pattern = new()
        {
            Id = "pattern-sequential",
            Name = "Sequential",
            Mode = "sequential",
            Availability = "available",
        };
        PatternAgentDefinitionDto agent = CreateAgent(
            id: "agent-reviewer",
            name: "Reviewer",
            instructions: "Review the proposal.");

        string instructions = AgentInstructionComposer.Compose(pattern, agent, agentIndex: 0);

        Assert.Equal("Review the proposal.", instructions);
    }

    [Fact]
    public void Compose_StrengthensHandoffTriageInstructions()
    {
        PatternDefinitionDto pattern = new()
        {
            Id = "pattern-handoff",
            Name = "Handoff",
            Mode = "handoff",
            Availability = "available",
        };
        PatternAgentDefinitionDto triage = CreateAgent(
            id: "agent-handoff-triage",
            name: "Triage",
            instructions: "You triage requests and must hand them off to the most appropriate specialist.");

        string instructions = AgentInstructionComposer.Compose(pattern, triage, agentIndex: 0);

        Assert.Contains("routing gate", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not perform the specialist", instructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Compose_StrengthensHandoffSpecialistInstructions()
    {
        PatternDefinitionDto pattern = new()
        {
            Id = "pattern-handoff",
            Name = "Handoff",
            Mode = "handoff",
            Availability = "available",
        };
        PatternAgentDefinitionDto specialist = CreateAgent(
            id: "agent-handoff-ux",
            name: "UX Specialist",
            instructions: "You focus on navigation, UX, and interaction details.");

        string instructions = AgentInstructionComposer.Compose(pattern, specialist, agentIndex: 1);

        Assert.Contains("Once the triage agent hands work to you", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("own the substantive answer", instructions, StringComparison.OrdinalIgnoreCase);
    }

    private static PatternAgentDefinitionDto CreateAgent(string id, string name, string instructions)
    {
        return new PatternAgentDefinitionDto
        {
            Id = id,
            Name = name,
            Instructions = instructions,
            Model = "gpt-5.4",
        };
    }
}
