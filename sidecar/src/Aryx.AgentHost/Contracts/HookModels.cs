using System.Text.Json.Serialization;

namespace Aryx.AgentHost.Contracts;

internal static class HookTypeNames
{
    public const string SessionStart = "sessionStart";
    public const string SessionEnd = "sessionEnd";
    public const string UserPromptSubmitted = "userPromptSubmitted";
    public const string PreToolUse = "preToolUse";
    public const string PostToolUse = "postToolUse";
    public const string ErrorOccurred = "errorOccurred";
}

internal sealed class HookConfigFile
{
    public int Version { get; init; }
    public HookConfigHooks Hooks { get; init; } = new();
}

internal sealed class HookConfigHooks
{
    public IReadOnlyList<HookCommandDefinition>? SessionStart { get; init; }
    public IReadOnlyList<HookCommandDefinition>? SessionEnd { get; init; }
    public IReadOnlyList<HookCommandDefinition>? UserPromptSubmitted { get; init; }
    public IReadOnlyList<HookCommandDefinition>? PreToolUse { get; init; }
    public IReadOnlyList<HookCommandDefinition>? PostToolUse { get; init; }
    public IReadOnlyList<HookCommandDefinition>? ErrorOccurred { get; init; }
}

internal sealed class HookCommandDefinition
{
    public string Type { get; init; } = string.Empty;
    public string? Bash { get; init; }

    [JsonPropertyName("powershell")]
    public string? PowerShell { get; init; }

    public string? Cwd { get; init; }
    public IReadOnlyDictionary<string, string>? Env { get; init; }
    public int? TimeoutSec { get; init; }
}

internal sealed class ResolvedHookSet
{
    public static ResolvedHookSet Empty { get; } = new();

    public IReadOnlyList<HookCommandDefinition> SessionStart { get; init; } = [];
    public IReadOnlyList<HookCommandDefinition> SessionEnd { get; init; } = [];
    public IReadOnlyList<HookCommandDefinition> UserPromptSubmitted { get; init; } = [];
    public IReadOnlyList<HookCommandDefinition> PreToolUse { get; init; } = [];
    public IReadOnlyList<HookCommandDefinition> PostToolUse { get; init; } = [];
    public IReadOnlyList<HookCommandDefinition> ErrorOccurred { get; init; } = [];

    public bool IsEmpty =>
        SessionStart.Count == 0
        && SessionEnd.Count == 0
        && UserPromptSubmitted.Count == 0
        && PreToolUse.Count == 0
        && PostToolUse.Count == 0
        && ErrorOccurred.Count == 0;
}
