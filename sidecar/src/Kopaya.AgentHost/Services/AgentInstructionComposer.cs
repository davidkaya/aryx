using Kopaya.AgentHost.Contracts;

namespace Kopaya.AgentHost.Services;

internal static class AgentInstructionComposer
{
    public static string Compose(
        PatternDefinitionDto pattern,
        PatternAgentDefinitionDto agent,
        int agentIndex,
        string workspaceKind = "project")
    {
        string baseInstructions = agent.Instructions.Trim();
        string workspaceGuidance = string.Equals(workspaceKind, "scratchpad", StringComparison.OrdinalIgnoreCase)
            ? """
              You are operating in scratchpad mode.
              Treat this session as pure ad-hoc Q&A rather than repository automation.
              Do not inspect, modify, create, or delete files, and do not behave as though you are working inside a user project.
              Answer conversationally and focus on the user's question directly.
              """
            : string.Empty;

        if (!string.Equals(pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase))
        {
            return JoinInstructionBlocks(baseInstructions, workspaceGuidance);
        }

        string runtimeGuidance = agentIndex == 0
            ? """
              You are the routing gate for this handoff workflow.
              Your job is to classify the request and hand it off to the most appropriate specialist as soon as you know who should own the substantive work.
              Do not perform the specialist's implementation, design, or execution work yourself once a specialist is appropriate.
              Only answer directly if the user is asking for pure triage or a minimal clarification that must happen before delegation.
              """
            : """
              You are a specialist participating in a handoff workflow.
              Once the triage agent hands work to you, you own the substantive answer within your specialty and should carry it through.
              Do not push the actual work back to triage unless you are blocked or the request is clearly outside your specialty.
              """;

        return JoinInstructionBlocks(baseInstructions, workspaceGuidance, runtimeGuidance);
    }

    private static string JoinInstructionBlocks(params string[] blocks)
    {
        return string.Join(
            "\n\n",
            blocks.Where(block => !string.IsNullOrWhiteSpace(block)).Select(block => block.Trim()));
    }
}
