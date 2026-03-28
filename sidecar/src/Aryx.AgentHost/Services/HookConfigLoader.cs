using System.Text.Json;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal static class HookConfigLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        AllowTrailingCommas = true,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
    };

    public static async Task<ResolvedHookSet> LoadAsync(string projectPath, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(projectPath);

        string hooksDirectory = Path.Combine(projectPath, ".github", "hooks");
        if (!Directory.Exists(hooksDirectory))
        {
            return ResolvedHookSet.Empty;
        }

        string[] hookFiles;
        try
        {
            hookFiles = Directory.GetFiles(hooksDirectory, "*.json", SearchOption.TopDirectoryOnly);
        }
        catch (IOException exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Failed to enumerate hook files in '{hooksDirectory}': {exception.Message}");
            return ResolvedHookSet.Empty;
        }
        catch (UnauthorizedAccessException exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Failed to enumerate hook files in '{hooksDirectory}': {exception.Message}");
            return ResolvedHookSet.Empty;
        }

        if (hookFiles.Length == 0)
        {
            return ResolvedHookSet.Empty;
        }

        Array.Sort(hookFiles, StringComparer.OrdinalIgnoreCase);

        List<HookCommandDefinition> sessionStart = [];
        List<HookCommandDefinition> sessionEnd = [];
        List<HookCommandDefinition> userPromptSubmitted = [];
        List<HookCommandDefinition> preToolUse = [];
        List<HookCommandDefinition> postToolUse = [];
        List<HookCommandDefinition> errorOccurred = [];

        foreach (string hookFile in hookFiles)
        {
            HookConfigFile? config = await ReadHookConfigAsync(hookFile, cancellationToken).ConfigureAwait(false);
            if (config is null)
            {
                continue;
            }

            if (config.Version != 1)
            {
                Console.Error.WriteLine($"[aryx hooks] Skipping '{hookFile}' because it declares unsupported version '{config.Version}'.");
                continue;
            }

            AddHooks(sessionStart, config.Hooks.SessionStart, HookTypeNames.SessionStart, hookFile);
            AddHooks(sessionEnd, config.Hooks.SessionEnd, HookTypeNames.SessionEnd, hookFile);
            AddHooks(userPromptSubmitted, config.Hooks.UserPromptSubmitted, HookTypeNames.UserPromptSubmitted, hookFile);
            AddHooks(preToolUse, config.Hooks.PreToolUse, HookTypeNames.PreToolUse, hookFile);
            AddHooks(postToolUse, config.Hooks.PostToolUse, HookTypeNames.PostToolUse, hookFile);
            AddHooks(errorOccurred, config.Hooks.ErrorOccurred, HookTypeNames.ErrorOccurred, hookFile);
        }

        if (
            sessionStart.Count == 0
            && sessionEnd.Count == 0
            && userPromptSubmitted.Count == 0
            && preToolUse.Count == 0
            && postToolUse.Count == 0
            && errorOccurred.Count == 0)
        {
            return ResolvedHookSet.Empty;
        }

        return new ResolvedHookSet
        {
            SessionStart = [.. sessionStart],
            SessionEnd = [.. sessionEnd],
            UserPromptSubmitted = [.. userPromptSubmitted],
            PreToolUse = [.. preToolUse],
            PostToolUse = [.. postToolUse],
            ErrorOccurred = [.. errorOccurred],
        };
    }

    private static void AddHooks(
        ICollection<HookCommandDefinition> target,
        IReadOnlyList<HookCommandDefinition>? definitions,
        string hookType,
        string hookFile)
    {
        if (definitions is not { Count: > 0 })
        {
            return;
        }

        foreach (HookCommandDefinition definition in definitions)
        {
            HookCommandDefinition? normalized = NormalizeDefinition(definition, hookType, hookFile);
            if (normalized is not null)
            {
                target.Add(normalized);
            }
        }
    }

    private static HookCommandDefinition? NormalizeDefinition(
        HookCommandDefinition definition,
        string hookType,
        string hookFile)
    {
        string type = NormalizeOptionalString(definition.Type) ?? string.Empty;
        if (!string.Equals(type, "command", StringComparison.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine($"[aryx hooks] Skipping '{hookType}' entry in '{hookFile}' because type '{definition.Type}' is unsupported.");
            return null;
        }

        string? bash = NormalizeOptionalString(definition.Bash);
        string? powerShell = NormalizeOptionalString(definition.PowerShell);
        if (bash is null && powerShell is null)
        {
            Console.Error.WriteLine($"[aryx hooks] Skipping '{hookType}' entry in '{hookFile}' because no shell command is configured.");
            return null;
        }

        int? timeoutSec = definition.TimeoutSec;
        if (timeoutSec is <= 0)
        {
            timeoutSec = null;
        }

        IReadOnlyDictionary<string, string>? env = NormalizeEnvironment(definition.Env);

        return new HookCommandDefinition
        {
            Type = "command",
            Bash = bash,
            PowerShell = powerShell,
            Cwd = NormalizeOptionalString(definition.Cwd),
            Env = env,
            TimeoutSec = timeoutSec,
        };
    }

    private static async Task<HookConfigFile?> ReadHookConfigAsync(string hookFile, CancellationToken cancellationToken)
    {
        try
        {
            await using FileStream stream = File.OpenRead(hookFile);
            return await JsonSerializer.DeserializeAsync<HookConfigFile>(stream, JsonOptions, cancellationToken).ConfigureAwait(false);
        }
        catch (JsonException exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Failed to parse '{hookFile}': {exception.Message}");
            return null;
        }
        catch (IOException exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Failed to read '{hookFile}': {exception.Message}");
            return null;
        }
        catch (UnauthorizedAccessException exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Failed to read '{hookFile}': {exception.Message}");
            return null;
        }
    }

    private static IReadOnlyDictionary<string, string>? NormalizeEnvironment(IReadOnlyDictionary<string, string>? environment)
    {
        if (environment is not { Count: > 0 })
        {
            return null;
        }

        Dictionary<string, string> normalized = new(StringComparer.Ordinal);
        foreach ((string key, string value) in environment)
        {
            string? normalizedKey = NormalizeOptionalString(key);
            if (normalizedKey is null)
            {
                continue;
            }

            normalized[normalizedKey] = value;
        }

        return normalized.Count == 0 ? null : normalized;
    }

    private static string? NormalizeOptionalString(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
