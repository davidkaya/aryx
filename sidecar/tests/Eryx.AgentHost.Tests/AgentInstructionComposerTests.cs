using Eryx.AgentHost.Contracts;
using Eryx.AgentHost.Services;

namespace Eryx.AgentHost.Tests;

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
    public void Compose_StrengthensGroupChatCollaborationRoles()
    {
        PatternDefinitionDto pattern = new()
        {
            Id = "pattern-group-chat",
            Name = "Group Chat",
            Mode = "group-chat",
            Availability = "available",
        };
        PatternAgentDefinitionDto writer = CreateAgent(
            id: "agent-group-writer",
            name: "Writer",
            instructions: "Draft an answer.");
        PatternAgentDefinitionDto reviewer = CreateAgent(
            id: "agent-group-reviewer",
            name: "Reviewer",
            instructions: "Review the draft.");

        string writerInstructions = AgentInstructionComposer.Compose(pattern, writer, agentIndex: 0);
        string reviewerInstructions = AgentInstructionComposer.Compose(pattern, reviewer, agentIndex: 1);

        Assert.Contains("collaborative multi-turn group chat", writerInstructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("refine your earlier draft", writerInstructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("specific critique or improvements", reviewerInstructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not restart the conversation", reviewerInstructions, StringComparison.OrdinalIgnoreCase);
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
        Assert.Contains("Do not inspect files", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("actual handoff", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not claim that you handed work off", instructions, StringComparison.OrdinalIgnoreCase);
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

    [Fact]
    public void Compose_AddsScratchpadGuidanceForProjectlessQaSessions()
    {
        PatternDefinitionDto pattern = new()
        {
            Id = "pattern-single",
            Name = "Single",
            Mode = "single",
            Availability = "available",
        };
        PatternAgentDefinitionDto agent = CreateAgent(
            id: "agent-primary",
            name: "Primary Agent",
            instructions: "You are a helpful assistant.");

        string instructions = AgentInstructionComposer.Compose(
            pattern,
            agent,
            agentIndex: 0,
            workspaceKind: "scratchpad");

        Assert.Contains("scratchpad mode", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("pure ad-hoc Q&A", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not inspect, modify, create, or delete files", instructions, StringComparison.OrdinalIgnoreCase);
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
