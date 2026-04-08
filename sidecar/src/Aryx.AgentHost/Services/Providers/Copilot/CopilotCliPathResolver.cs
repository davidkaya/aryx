using System.Collections;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal static class CopilotCliPathResolver
{
    private const string CopilotCommandName = "copilot";
    private const string DefaultWindowsCommandProcessor = "cmd.exe";
    private const string DefaultWindowsPathExtensions = ".COM;.EXE;.BAT;.CMD";
    private const char WindowsSearchPathSeparator = ';';
    private const char UnixSearchPathSeparator = ':';
    private const char WindowsDirectorySeparator = '\\';
    private const char UnixDirectorySeparator = '/';

    private static readonly string[] BlockedCliEnvironmentPrefixes = ["BUN_", "COPILOT_", "ELECTRON_", "NODE_", "NPM_"];

    public static CopilotClientOptions CreateClientOptions()
    {
        return CreateClientOptions(ResolveCliContext());
    }

    internal static CopilotCliContext ResolveCliContext()
    {
        string? cliPath = Resolve(
            Environment.GetEnvironmentVariable("PATH"),
            Environment.GetEnvironmentVariable("PATHEXT"),
            OperatingSystem.IsWindows(),
            File.Exists);

        if (string.IsNullOrWhiteSpace(cliPath))
        {
            throw new InvalidOperationException(
                "Aryx requires the system-installed 'copilot' command on PATH. Install the GitHub Copilot CLI and ensure it is available in the current environment.");
        }

        CopilotCliLaunch launch = ResolveCliLaunch(
            cliPath,
            OperatingSystem.IsWindows(),
            Environment.GetEnvironmentVariable("ComSpec"));

        return new CopilotCliContext(
            cliPath,
            launch.Path,
            launch.Args,
            ResolveCliEnvironment(GetCurrentEnvironmentVariables()));
    }

    internal static CopilotClientOptions CreateClientOptions(CopilotCliContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        return new CopilotClientOptions
        {
            CliPath = context.LaunchPath,
            CliArgs = context.LaunchArgs,
            Environment = context.Environment,
        };
    }

    internal static string? Resolve(
        string? pathValue,
        string? pathExtValue,
        bool isWindows,
        Func<string, bool> fileExists)
    {
        ArgumentNullException.ThrowIfNull(fileExists);
        return ResolveCliPath(pathValue, pathExtValue, isWindows, fileExists);
    }

    internal static IReadOnlyDictionary<string, string> ResolveCliEnvironment(
        IEnumerable<KeyValuePair<string, string?>> environmentVariables)
    {
        ArgumentNullException.ThrowIfNull(environmentVariables);

        Dictionary<string, string> sanitizedEnvironment = new(StringComparer.OrdinalIgnoreCase);
        foreach (KeyValuePair<string, string?> entry in environmentVariables)
        {
            if (ShouldSkipEnvironmentEntry(entry))
            {
                continue;
            }

            sanitizedEnvironment[entry.Key] = entry.Value!;
        }

        return sanitizedEnvironment;
    }

    internal static CopilotCliLaunch ResolveCliLaunch(string cliPath, bool isWindows, string? commandProcessorPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(cliPath);

        if (!isWindows)
        {
            return new CopilotCliLaunch(cliPath, []);
        }

        return new CopilotCliLaunch(
            ResolveCommandProcessorPath(commandProcessorPath),
            ["/d", "/s", "/c", CopilotCommandName]);
    }

    private static bool ShouldSkipEnvironmentEntry(KeyValuePair<string, string?> entry)
    {
        if (string.IsNullOrWhiteSpace(entry.Key) || entry.Value is null)
        {
            return true;
        }

        string normalizedKey = entry.Key.ToUpperInvariant();
        return BlockedCliEnvironmentPrefixes.Any(prefix => normalizedKey.StartsWith(prefix, StringComparison.Ordinal));
    }

    private static string ResolveCommandProcessorPath(string? commandProcessorPath)
    {
        return string.IsNullOrWhiteSpace(commandProcessorPath)
            ? DefaultWindowsCommandProcessor
            : commandProcessorPath;
    }

    private static string? ResolveCliPath(
        string? pathValue,
        string? pathExtValue,
        bool isWindows,
        Func<string, bool> fileExists)
    {
        foreach (string directory in EnumerateDistinctSearchDirectories(pathValue, isWindows))
        {
            foreach (string candidateName in GetCandidateFileNames(pathExtValue, isWindows))
            {
                string candidatePath = CombineSearchPath(directory, candidateName, isWindows);
                if (fileExists(candidatePath))
                {
                    return candidatePath;
                }
            }
        }

        return null;
    }

    private static IEnumerable<string> EnumerateDistinctSearchDirectories(string? pathValue, bool isWindows)
    {
        if (string.IsNullOrWhiteSpace(pathValue))
        {
            yield break;
        }

        StringComparer comparer = isWindows ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
        foreach (string directory in pathValue
            .Split(GetSearchPathSeparator(isWindows), StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(segment => segment.Trim('"'))
            .Where(segment => !string.IsNullOrWhiteSpace(segment))
            .Distinct(comparer))
        {
            yield return directory;
        }
    }

    private static IEnumerable<string> GetCandidateFileNames(string? pathExtValue, bool isWindows)
    {
        yield return CopilotCommandName;

        if (!isWindows)
        {
            yield break;
        }

        HashSet<string> yielded = new(StringComparer.OrdinalIgnoreCase)
        {
            CopilotCommandName,
        };

        string extensions = string.IsNullOrWhiteSpace(pathExtValue)
            ? DefaultWindowsPathExtensions
            : pathExtValue;

        foreach (string extension in extensions
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(extension => extension.StartsWith('.')))
        {
            string candidateName = CopilotCommandName + extension;
            if (yielded.Add(candidateName))
            {
                yield return candidateName;
            }
        }
    }

    private static char GetSearchPathSeparator(bool isWindows)
    {
        return isWindows ? WindowsSearchPathSeparator : UnixSearchPathSeparator;
    }

    private static string CombineSearchPath(string directory, string fileName, bool isWindows)
    {
        if (string.IsNullOrEmpty(directory))
        {
            return fileName;
        }

        if (EndsWithDirectorySeparator(directory, isWindows))
        {
            return directory + fileName;
        }

        return directory + GetDirectorySeparator(isWindows) + fileName;
    }

    private static bool EndsWithDirectorySeparator(string path, bool isWindows)
    {
        char lastCharacter = path[^1];
        return lastCharacter == GetDirectorySeparator(isWindows)
            || (isWindows && lastCharacter == UnixDirectorySeparator);
    }

    private static char GetDirectorySeparator(bool isWindows)
    {
        return isWindows ? WindowsDirectorySeparator : UnixDirectorySeparator;
    }

    private static IEnumerable<KeyValuePair<string, string?>> GetCurrentEnvironmentVariables()
    {
        return Environment.GetEnvironmentVariables()
            .Cast<DictionaryEntry>()
            .Select(entry => new KeyValuePair<string, string?>(
                entry.Key?.ToString() ?? string.Empty,
                entry.Value?.ToString()));
    }
}

internal sealed record CopilotCliContext(
    string CliPath,
    string LaunchPath,
    string[] LaunchArgs,
    IReadOnlyDictionary<string, string> Environment);

internal sealed record CopilotCliLaunch(string Path, string[] Args);
