using Eryx.AgentHost.Contracts;
using Eryx.AgentHost.Services;

namespace Eryx.AgentHost.Tests;

public sealed class HandoffWorkflowGuidanceTests
{
    [Fact]
    public void CreateWorkflowInstructions_RequiresRealHandoffs()
    {
        string instructions = HandoffWorkflowGuidance.CreateWorkflowInstructions();

        Assert.Contains("explicit handoffs", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not claim that you delegated", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not narrate a handoff", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Specialists should complete the substantive work", instructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CreateForwardReason_UsesTargetSpecialtyAndOwnership()
    {
        PatternAgentDefinitionDto specialist = new()
        {
            Id = "agent-handoff-ux",
            Name = "UX Specialist",
            Description = "Handles user experience questions.",
            Instructions = "Focus on UX.",
            Model = "claude-opus-4.5",
        };

        string reason = HandoffWorkflowGuidance.CreateForwardReason(specialist);

        Assert.Contains("Handles user experience questions", reason, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("UX Specialist", reason, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("substantive response", reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CreateReturnReason_RestrictsReturnToReroutingCases()
    {
        PatternAgentDefinitionDto triage = new()
        {
            Id = "agent-handoff-triage",
            Name = "Triage",
            Description = "Routes the request to the right specialist.",
            Instructions = "Triages requests.",
            Model = "gpt-5.4",
        };

        string reason = HandoffWorkflowGuidance.CreateReturnReason(triage);

        Assert.Contains("Triage", reason, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("re-routing", reason, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("outside your specialty", reason, StringComparison.OrdinalIgnoreCase);
    }
}
