using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal static class HandoffWorkflowGuidance
{
    public static string CreateWorkflowInstructions()
    {
        return """
               This workflow uses explicit handoffs to transfer ownership between agents.
               If you are acting as the routing or triage agent, classify the request and hand it off to the best specialist as soon as ownership is clear.
               If another agent should do the substantive work, perform an actual handoff instead of answering as though the handoff already happened.
               For any substantive task, your next meaningful action must be the actual handoff rather than a plain-text promise to delegate later.
               Do not claim that you delegated unless you actually executed the handoff.
               If a specialist is appropriate, do not inspect files, call tools, draft the implementation, or produce the final user-facing answer before handing off.
               Only answer directly when the request is pure triage or a minimal clarification is required before delegation.
               Do not narrate a handoff in plain text without executing the handoff itself.
               If you receive work as a specialist, own the substantive answer within your specialty and carry it through.
               Do not push the work back to triage unless you are blocked or the request is clearly outside your specialty.
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
