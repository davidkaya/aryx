using System.Text.Json;
using System.Text.Json.Serialization;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal static class CopilotSessionHooks
{
    private const string AskUserToolName = "ask_user";
    private const string AllowDecision = "allow";
    private const string AskDecision = "ask";
    private const string DenyDecision = "deny";
    private const string ExitPlanModeToolName = "exit_plan_mode";
    private const string FetchCopilotCliDocumentationToolName = "fetch_copilot_cli_documentation";
    private const string HandoffToolPrefix = "handoff_to_";
    private const string ListAgentsToolName = "list_agents";
    private const string ReadAgentToolName = "read_agent";
    private const string ReportIntentToolName = "report_intent";
    private const string SkillToolName = "skill";
    private const string SqlToolName = "sql";
    private const string TaskToolName = "task";
    private const string TaskCompleteToolName = "task_complete";
    private const string UpdateTodoToolName = "update_todo";
    private static readonly HashSet<string> AlwaysAllowedToolNames = new(StringComparer.OrdinalIgnoreCase)
    {
        AskUserToolName,
        ExitPlanModeToolName,
        FetchCopilotCliDocumentationToolName,
        ListAgentsToolName,
        ReadAgentToolName,
        ReportIntentToolName,
        SkillToolName,
        SqlToolName,
        TaskToolName,
        TaskCompleteToolName,
        UpdateTodoToolName,
    };
    private static readonly JsonSerializerOptions HookJsonOptions = CreateHookJsonOptions();

    public static SessionHooks Create(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agentDefinition,
        ResolvedHookSet? configuredHooks = null,
        IHookCommandRunner? hookCommandRunner = null)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(agentDefinition);
        ResolvedHookSet hooks = configuredHooks ?? ResolvedHookSet.Empty;
        IHookCommandRunner runner = hookCommandRunner ?? HookCommandRunner.Instance;

        return new SessionHooks
        {
            OnPreToolUse = (input, _) => CreatePreToolUseOutputAsync(command, agentDefinition, hooks, runner, input),
            OnPostToolUse = (input, _) => RunPostToolUseHooksAsync(command, hooks, runner, input),
            OnUserPromptSubmitted = (input, _) => RunUserPromptSubmittedHooksAsync(command, hooks, runner, input),
            OnSessionStart = (input, _) => RunSessionStartHooksAsync(command, hooks, runner, input),
            OnSessionEnd = (input, _) => RunSessionEndHooksAsync(command, hooks, runner, input),
            OnErrorOccurred = (input, _) => RunErrorOccurredHooksAsync(command, hooks, runner, input),
        };
    }

    private static async Task<PreToolUseHookOutput?> CreatePreToolUseOutputAsync(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agentDefinition,
        ResolvedHookSet configuredHooks,
        IHookCommandRunner hookCommandRunner,
        PreToolUseHookInput input)
    {
        if (configuredHooks.PreToolUse.Count > 0)
        {
            string payload = SerializeHookInput(new FilePreToolUseHookInput
            {
                Timestamp = input.Timestamp,
                Cwd = input.Cwd,
                ToolName = input.ToolName,
                ToolArgs = SerializeHookValue(input.ToolArgs),
            });

            foreach (HookCommandDefinition hook in configuredHooks.PreToolUse)
            {
                string? hookOutput = await hookCommandRunner.RunAsync(
                        hook,
                        payload,
                        command.ProjectPath,
                        CancellationToken.None)
                    .ConfigureAwait(false);

                PreToolUseHookOutput? decision = ParsePreToolUseDecision(hookOutput);
                if (string.Equals(decision?.PermissionDecision, DenyDecision, StringComparison.OrdinalIgnoreCase))
                {
                    return decision;
                }
            }
        }

        return CreateApprovalPolicyOutput(command, agentDefinition, input);
    }

    private static async Task<PostToolUseHookOutput?> RunPostToolUseHooksAsync(
        RunTurnCommandDto command,
        ResolvedHookSet configuredHooks,
        IHookCommandRunner hookCommandRunner,
        PostToolUseHookInput input)
    {
        await RunConfiguredHooksAsync(
                configuredHooks.PostToolUse,
                hookCommandRunner,
                command.ProjectPath,
                SerializeHookInput(new FilePostToolUseHookInput
                {
                    Timestamp = input.Timestamp,
                    Cwd = input.Cwd,
                    ToolName = input.ToolName,
                    ToolArgs = SerializeHookValue(input.ToolArgs),
                    ToolResult = input.ToolResult,
                }))
            .ConfigureAwait(false);

        return null;
    }

    private static async Task<UserPromptSubmittedHookOutput?> RunUserPromptSubmittedHooksAsync(
        RunTurnCommandDto command,
        ResolvedHookSet configuredHooks,
        IHookCommandRunner hookCommandRunner,
        UserPromptSubmittedHookInput input)
    {
        await RunConfiguredHooksAsync(
                configuredHooks.UserPromptSubmitted,
                hookCommandRunner,
                command.ProjectPath,
                SerializeHookInput(new FileUserPromptSubmittedHookInput
                {
                    Timestamp = input.Timestamp,
                    Cwd = input.Cwd,
                    Prompt = input.Prompt,
                }))
            .ConfigureAwait(false);

        return null;
    }

    private static async Task<SessionStartHookOutput?> RunSessionStartHooksAsync(
        RunTurnCommandDto command,
        ResolvedHookSet configuredHooks,
        IHookCommandRunner hookCommandRunner,
        SessionStartHookInput input)
    {
        await RunConfiguredHooksAsync(
                configuredHooks.SessionStart,
                hookCommandRunner,
                command.ProjectPath,
                SerializeHookInput(new FileSessionStartHookInput
                {
                    Timestamp = input.Timestamp,
                    Cwd = input.Cwd,
                    Source = input.Source,
                    InitialPrompt = input.InitialPrompt,
                }))
            .ConfigureAwait(false);

        return null;
    }

    private static async Task<SessionEndHookOutput?> RunSessionEndHooksAsync(
        RunTurnCommandDto command,
        ResolvedHookSet configuredHooks,
        IHookCommandRunner hookCommandRunner,
        SessionEndHookInput input)
    {
        await RunConfiguredHooksAsync(
                configuredHooks.SessionEnd,
                hookCommandRunner,
                command.ProjectPath,
                SerializeHookInput(new FileSessionEndHookInput
                {
                    Timestamp = input.Timestamp,
                    Cwd = input.Cwd,
                    Reason = input.Reason,
                    FinalMessage = input.FinalMessage,
                    Error = input.Error,
                }))
            .ConfigureAwait(false);

        return null;
    }

    private static async Task<ErrorOccurredHookOutput?> RunErrorOccurredHooksAsync(
        RunTurnCommandDto command,
        ResolvedHookSet configuredHooks,
        IHookCommandRunner hookCommandRunner,
        ErrorOccurredHookInput input)
    {
        await RunConfiguredHooksAsync(
                configuredHooks.ErrorOccurred,
                hookCommandRunner,
                command.ProjectPath,
                SerializeHookInput(new FileErrorOccurredHookInput
                {
                    Timestamp = input.Timestamp,
                    Cwd = input.Cwd,
                    Error = new FileHookError
                    {
                        Message = input.Error,
                        Context = input.ErrorContext,
                        Recoverable = input.Recoverable,
                    },
                }))
            .ConfigureAwait(false);

        return null;
    }

    private static async Task RunConfiguredHooksAsync(
        IReadOnlyList<HookCommandDefinition> hooks,
        IHookCommandRunner hookCommandRunner,
        string projectPath,
        string payload)
    {
        if (hooks.Count == 0)
        {
            return;
        }

        foreach (HookCommandDefinition hook in hooks)
        {
            await hookCommandRunner.RunAsync(
                    hook,
                    payload,
                    projectPath,
                    CancellationToken.None)
                .ConfigureAwait(false);
        }
    }

    private static PreToolUseHookOutput CreateApprovalPolicyOutput(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agentDefinition,
        PreToolUseHookInput input)
    {
        string? toolName = Normalize(input.ToolName);
        if (IsAlwaysAllowedTool(toolName))
        {
            return new PreToolUseHookOutput
            {
                PermissionDecision = AllowDecision,
            };
        }

        string? autoApprovedToolName = CopilotApprovalCoordinator.ResolveHookToolCategory(toolName) ?? toolName;

        bool requiresApproval = CopilotApprovalCoordinator.RequiresToolCallApproval(
            command.Pattern.ApprovalPolicy,
            agentDefinition.Id,
            toolName,
            autoApprovedToolName);

        return new PreToolUseHookOutput
        {
            PermissionDecision = requiresApproval ? AskDecision : AllowDecision,
        };
    }

    private static PreToolUseHookOutput? ParsePreToolUseDecision(string? hookOutput)
    {
        if (string.IsNullOrWhiteSpace(hookOutput))
        {
            return null;
        }

        try
        {
            FilePreToolUseHookOutput? parsed = JsonSerializer.Deserialize<FilePreToolUseHookOutput>(hookOutput, HookJsonOptions);
            if (!string.Equals(parsed?.PermissionDecision, DenyDecision, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            return new PreToolUseHookOutput
            {
                PermissionDecision = DenyDecision,
                PermissionDecisionReason = Normalize(parsed?.PermissionDecisionReason),
            };
        }
        catch (JsonException exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Ignoring invalid preToolUse hook output: {exception.Message}");
            return null;
        }
    }

    private static string SerializeHookInput<T>(T input)
        => JsonSerializer.Serialize(input, HookJsonOptions);

    private static string SerializeHookValue(object? value)
        => JsonSerializer.Serialize(value, HookJsonOptions);

    private static JsonSerializerOptions CreateHookJsonOptions()
    {
        JsonSerializerOptions options = JsonSerialization.CreateWebOptions();
        options.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        return options;
    }

    private static bool IsAlwaysAllowedTool(string? toolName)
    {
        string? normalizedToolName = Normalize(toolName);
        return normalizedToolName is not null
            && (AlwaysAllowedToolNames.Contains(normalizedToolName)
                || normalizedToolName.StartsWith(HandoffToolPrefix, StringComparison.OrdinalIgnoreCase));
    }

    private static string? Normalize(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed class FileSessionStartHookInput
    {
        public long Timestamp { get; init; }
        public string Cwd { get; init; } = string.Empty;
        public string Source { get; init; } = string.Empty;
        public string? InitialPrompt { get; init; }
    }

    private sealed class FileSessionEndHookInput
    {
        public long Timestamp { get; init; }
        public string Cwd { get; init; } = string.Empty;
        public string Reason { get; init; } = string.Empty;
        public string? FinalMessage { get; init; }
        public string? Error { get; init; }
    }

    private sealed class FileUserPromptSubmittedHookInput
    {
        public long Timestamp { get; init; }
        public string Cwd { get; init; } = string.Empty;
        public string Prompt { get; init; } = string.Empty;
    }

    private sealed class FilePreToolUseHookInput
    {
        public long Timestamp { get; init; }
        public string Cwd { get; init; } = string.Empty;
        public string ToolName { get; init; } = string.Empty;
        public string ToolArgs { get; init; } = "null";
    }

    private sealed class FilePostToolUseHookInput
    {
        public long Timestamp { get; init; }
        public string Cwd { get; init; } = string.Empty;
        public string ToolName { get; init; } = string.Empty;
        public string ToolArgs { get; init; } = "null";
        public object? ToolResult { get; init; }
    }

    private sealed class FileErrorOccurredHookInput
    {
        public long Timestamp { get; init; }
        public string Cwd { get; init; } = string.Empty;
        public FileHookError Error { get; init; } = new();
    }

    private sealed class FileHookError
    {
        public string Message { get; init; } = string.Empty;
        public string Context { get; init; } = string.Empty;
        public bool Recoverable { get; init; }
    }

    private sealed class FilePreToolUseHookOutput
    {
        public string? PermissionDecision { get; init; }
        public string? PermissionDecisionReason { get; init; }
    }
}
