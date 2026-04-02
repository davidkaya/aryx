using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal static class AgentInstructionComposer
{
    public static string Compose(
        PatternDefinitionDto pattern,
        PatternAgentDefinitionDto agent,
        int agentIndex,
        string workspaceKind = "project",
        string interactionMode = "interactive",
        string? projectInstructions = null,
        RunTurnPromptInvocationDto? promptInvocation = null)
    {
        string baseInstructions = agent.Instructions.Trim();
        string repositoryInstructions = projectInstructions?.Trim() ?? string.Empty;
        string promptInvocationInstructions = FormatPromptInvocation(promptInvocation);
        string workspaceGuidance = string.Equals(workspaceKind, "scratchpad", StringComparison.OrdinalIgnoreCase)
            ? """
              You are operating in scratchpad mode.
              Treat this session as ad-hoc work inside the scratchpad workspace rather than repository automation against a connected user project.
              You may use the available tools and files inside the scratchpad workspace when they help answer the request.
              Do not assume there is a connected repository, checked-out branch, or project-specific context unless the user provides it in the conversation.
              Answer conversationally and focus on the user's question directly.
              """
            : string.Empty;
        string planModeGuidance = string.Equals(interactionMode, "plan", StringComparison.OrdinalIgnoreCase)
            ? """
              You are operating in plan mode.
              Your job in this phase is to analyze the request, identify constraints, and produce a concrete implementation plan instead of carrying out the implementation.
              Once the plan is ready, call the built-in `exit_plan_mode` tool so the host can present the plan for review.
              Do not continue into implementation, file edits, builds, or tests after producing the plan unless the user explicitly asks to leave plan mode and proceed.
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

            return JoinInstructionBlocks(
                baseInstructions,
                repositoryInstructions,
                promptInvocationInstructions,
                workspaceGuidance,
                planModeGuidance,
                groupChatGuidance);
        }

        return JoinInstructionBlocks(
            baseInstructions,
            repositoryInstructions,
            promptInvocationInstructions,
            workspaceGuidance,
            planModeGuidance);
    }

    private static string JoinInstructionBlocks(params string[] blocks)
    {
        return string.Join(
            "\n\n",
            blocks.Where(block => !string.IsNullOrWhiteSpace(block)).Select(block => block.Trim()));
    }

    private static string FormatPromptInvocation(RunTurnPromptInvocationDto? promptInvocation)
    {
        string? resolvedPrompt = promptInvocation?.ResolvedPrompt?.Trim();
        if (string.IsNullOrWhiteSpace(resolvedPrompt))
        {
            return string.Empty;
        }

        List<string> lines =
        [
            "The current turn was started from a repository prompt file.",
            "Treat the prompt body below as the task directive for this turn rather than as prior user chat history.",
            $"Source: {promptInvocation!.SourcePath.Trim()}",
            $"Name: {promptInvocation.Name.Trim()}"
        ];

        if (!string.IsNullOrWhiteSpace(promptInvocation.Description))
        {
            lines.Add($"Description: {promptInvocation.Description.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(promptInvocation.Agent))
        {
            lines.Add($"Agent: {promptInvocation.Agent.Trim()}");
        }

        if (promptInvocation.Tools is not null)
        {
            List<string> toolNames = promptInvocation.Tools
                .Where(tool => !string.IsNullOrWhiteSpace(tool))
                .Select(tool => tool.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            lines.Add(toolNames.Count > 0
                ? $"Tools: {string.Join(", ", toolNames)}"
                : "Tools: none");
        }

        lines.Add("Prompt instructions:");
        lines.Add(resolvedPrompt);
        return string.Join("\n", lines);
    }
}
