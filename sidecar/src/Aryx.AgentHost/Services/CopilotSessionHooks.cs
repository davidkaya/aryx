using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal static class CopilotSessionHooks
{
    private const string AllowDecision = "allow";
    private const string AskDecision = "ask";

    public static SessionHooks Create(RunTurnCommandDto command, PatternAgentDefinitionDto agentDefinition)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(agentDefinition);

        return new SessionHooks
        {
            OnPreToolUse = (input, _) => Task.FromResult<PreToolUseHookOutput?>(
                CreatePreToolUseOutput(command, agentDefinition, input)),
            OnPostToolUse = static (_, _) => Task.FromResult<PostToolUseHookOutput?>(null),
            OnUserPromptSubmitted = static (_, _) => Task.FromResult<UserPromptSubmittedHookOutput?>(null),
            OnSessionStart = static (_, _) => Task.FromResult<SessionStartHookOutput?>(null),
            OnSessionEnd = static (_, _) => Task.FromResult<SessionEndHookOutput?>(null),
            OnErrorOccurred = static (_, _) => Task.FromResult<ErrorOccurredHookOutput?>(null),
        };
    }

    private static PreToolUseHookOutput CreatePreToolUseOutput(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agentDefinition,
        PreToolUseHookInput input)
    {
        bool requiresApproval = CopilotApprovalCoordinator.RequiresToolCallApproval(
            command.Pattern.ApprovalPolicy,
            agentDefinition.Id,
            Normalize(input.ToolName),
            Normalize(input.ToolName));

        return new PreToolUseHookOutput
        {
            PermissionDecision = requiresApproval ? AskDecision : AllowDecision,
        };
    }

    private static string? Normalize(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
