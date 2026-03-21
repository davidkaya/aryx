using System.Runtime.InteropServices;
using GitHub.Copilot.SDK;

namespace Kopaya.AgentHost.Services;

internal static class CopilotCliPathResolver
{
    private const string CopilotCommandName = "copilot";
    private const string DefaultWindowsPathExtensions = ".COM;.EXE;.BAT;.CMD";

    public static CopilotClientOptions? CreateClientOptions()
    {
        CopilotCliResolution resolution = Resolve(
            Environment.ProcessPath,
            Environment.GetEnvironmentVariable("PATH"),
            Environment.GetEnvironmentVariable("PATHEXT"),
            RuntimeInformation.IsOSPlatform(OSPlatform.Windows),
            File.Exists);

        if (!resolution.ShouldOverrideCliPath)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(resolution.CliPath))
        {
            throw new InvalidOperationException(
                "Development sidecar could not find the system-installed 'copilot' command on PATH. Install the GitHub Copilot CLI or provide an explicit CliPath.");
        }

        return new CopilotClientOptions
        {
            CliPath = resolution.CliPath,
        };
    }

    internal static CopilotCliResolution Resolve(
        string? processPath,
        string? pathValue,
        string? pathExtValue,
        bool isWindows,
        Func<string, bool> fileExists)
    {
        ArgumentNullException.ThrowIfNull(fileExists);

        if (!IsDevelopmentHost(processPath))
        {
            return default;
        }

        return new CopilotCliResolution(
            ShouldOverrideCliPath: true,
            CliPath: ResolveCliPath(pathValue, pathExtValue, isWindows, fileExists));
    }

    private static bool IsDevelopmentHost(string? processPath)
    {
        if (string.IsNullOrWhiteSpace(processPath))
        {
            return false;
        }

        return string.Equals(
            Path.GetFileNameWithoutExtension(processPath),
            "dotnet",
            StringComparison.OrdinalIgnoreCase);
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

internal readonly record struct CopilotCliResolution(bool ShouldOverrideCliPath, string? CliPath);
