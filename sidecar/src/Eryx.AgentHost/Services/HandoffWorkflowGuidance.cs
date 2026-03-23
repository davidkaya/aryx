using Eryx.AgentHost.Contracts;

namespace Eryx.AgentHost.Services;

internal static class HandoffWorkflowGuidance
{
    public static string CreateWorkflowInstructions()
    {
        return """
               This workflow uses explicit handoffs to transfer ownership between agents.
               If another agent should do the substantive work, perform an actual handoff instead of answering as though the handoff already happened.
               Do not claim that you delegated unless you actually executed the handoff.
               The triage agent should route to the best specialist promptly once ownership is clear.
               Specialists should complete the substantive work after handoff and only hand control back when the task needs re-routing, broader coordination, or is outside their specialty.
               """;
    }

    public static string CreateForwardReason(PatternAgentDefinitionDto target)
    {
        string specialty = string.IsNullOrWhiteSpace(target.Description)
            ? target.Name
            : target.Description.TrimEnd('.');

        return $"Hand off when the request primarily concerns {specialty}. Once handed off, let {target.Name} own the substantive response.";
    }

    public static string CreateReturnReason(PatternAgentDefinitionDto triageAgent)
    {
        return $"Hand off back to {triageAgent.Name} only when the task needs re-routing, cross-specialist coordination, or is outside your specialty.";
    }
}
