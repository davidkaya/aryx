using Eryx.AgentHost.Contracts;

namespace Eryx.AgentHost.Services;

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
              Treat this session as ad-hoc work inside the scratchpad workspace rather than repository automation against a connected user project.
              You may use the available tools and files inside the scratchpad workspace when they help answer the request.
              Do not assume there is a connected repository, checked-out branch, or project-specific context unless the user provides it in the conversation.
              Answer conversationally and focus on the user's question directly.
              """
            : string.Empty;

        if (string.Equals(pattern.Mode, "group-chat", StringComparison.OrdinalIgnoreCase))
        {
            string groupChatGuidance = agentIndex == 0
                ? """
                  You are participating in a collaborative multi-turn group chat under a round-robin manager.
                  On your first turn, produce the initial draft for the user.
                  On later turns, refine your earlier draft based on the other agents' feedback instead of restarting from scratch.
                  Do not greet the user again or reset the conversation once work is underway.
                  """
                : """
                  You are participating in a collaborative multi-turn group chat under a round-robin manager.
                  Build on the latest draft from the other agents and contribute specific critique or improvements.
                  Do not restart the conversation, greet the user again, or answer as though no draft exists yet.
                  Focus on refining the answer already in progress.
                  """;

            return JoinInstructionBlocks(baseInstructions, workspaceGuidance, groupChatGuidance);
        }

        if (!string.Equals(pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase))
        {
            return JoinInstructionBlocks(baseInstructions, workspaceGuidance);
        }

        string runtimeGuidance = agentIndex == 0
            ? """
              You are the routing gate for this handoff workflow.
              Your job is to classify the request and hand it off to the most appropriate specialist as soon as you know who should own the substantive work.
              For any substantive task, your next meaningful action must be the actual handoff rather than a plain-text promise to delegate later.
              Do not inspect files, call tools, draft the implementation, or produce the final user-facing answer yourself once a specialist is appropriate.
              Do not claim that you handed work off unless you actually executed the handoff.
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
