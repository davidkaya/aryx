using GitHub.Copilot.SDK;

namespace Kopaya.AgentHost.Services;

internal static class CopilotCliPathResolver
{
    private const string CopilotCommandName = "copilot";
    private const string DefaultWindowsPathExtensions = ".COM;.EXE;.BAT;.CMD";

    public static CopilotClientOptions CreateClientOptions()
    {
        string? cliPath = Resolve(
            Environment.GetEnvironmentVariable("PATH"),
            Environment.GetEnvironmentVariable("PATHEXT"),
            OperatingSystem.IsWindows(),
            File.Exists);

        if (string.IsNullOrWhiteSpace(cliPath))
        {
            throw new InvalidOperationException(
                "Kopaya requires the system-installed 'copilot' command on PATH. Install the GitHub Copilot CLI and ensure it is available in the current environment.");
        }

        return new CopilotClientOptions
        {
            CliPath = cliPath,
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

    private static string? ResolveCliPath(
        string? pathValue,
        string? pathExtValue,
        bool isWindows,
        Func<string, bool> fileExists)
    {
        if (string.IsNullOrWhiteSpace(pathValue))
        {
            return null;
        }

        StringComparer comparer = isWindows ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

        foreach (string directory in pathValue
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(segment => segment.Trim('"'))
            .Where(segment => !string.IsNullOrWhiteSpace(segment))
            .Distinct(comparer))
        {
            foreach (string candidateName in GetCandidateFileNames(pathExtValue, isWindows))
            {
                string candidatePath = Path.Combine(directory, candidateName);
                if (fileExists(candidatePath))
                {
                    return candidatePath;
                }
            }
        }

        return null;
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
}
