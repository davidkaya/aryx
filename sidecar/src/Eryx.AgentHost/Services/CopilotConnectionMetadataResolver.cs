using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using GitHub.Copilot.SDK;
using Eryx.AgentHost.Contracts;

namespace Eryx.AgentHost.Services;

internal static partial class CopilotConnectionMetadataResolver
{
    private static readonly string[] LatestVersionIndicators =
    [
        "running the latest version",
        "already up to date",
        "is up to date",
    ];

    private static readonly string[] OutdatedVersionIndicators =
    [
        "newer version",
        "new version available",
        "update available",
        "download link",
    ];

    private static readonly TimeSpan CopilotVersionTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan GitHubContextTimeout = TimeSpan.FromSeconds(4);

    internal static async Task<SidecarCopilotCliVersionDiagnosticsDto> GetCliVersionDiagnosticsAsync(
        CopilotCliContext cliContext,
        CancellationToken cancellationToken)
    {
        try
        {
            (string executablePath, string[] arguments) = CreateCliCommand(cliContext, "version");
            CommandResult result = await RunProcessAsync(
                executablePath: executablePath,
                arguments: arguments,
                environment: cliContext.Environment,
                timeout: CopilotVersionTimeout,
                cancellationToken).ConfigureAwait(false);

            return ParseCliVersionOutput(result.StandardOutput, result.StandardError, result.ExitCode);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new SidecarCopilotCliVersionDiagnosticsDto
            {
                Status = "unknown",
                Detail = "Timed out while checking the installed GitHub Copilot CLI version.",
            };
        }
        catch (Exception exception)
        {
            return new SidecarCopilotCliVersionDiagnosticsDto
            {
                Status = "unknown",
                Detail = $"Failed to check the installed GitHub Copilot CLI version: {exception.Message}",
            };
        }
    }

    internal static (string ExecutablePath, string[] Arguments) CreateCliCommand(
        CopilotCliContext cliContext,
        params string[] arguments)
    {
        ArgumentNullException.ThrowIfNull(cliContext);
        ArgumentNullException.ThrowIfNull(arguments);

        return (
            cliContext.LaunchPath,
            [.. cliContext.LaunchArgs, .. arguments]);
    }

    internal static SidecarCopilotCliVersionDiagnosticsDto ParseCliVersionOutput(
        string? standardOutput,
        string? standardError = null,
        int exitCode = 0)
    {
        string output = NormalizeOutput(standardOutput, standardError);
        string? installedVersion = ExtractInstalledVersion(output);
        string status = ClassifyCliVersionStatus(output, exitCode);
        string? latestVersion = status switch
        {
            "latest" => installedVersion,
            "outdated" => ExtractLatestVersion(output, installedVersion),
            _ => null,
        };

        string? detail = string.IsNullOrWhiteSpace(output)
            ? null
            : output;

        if (detail is null && status == "unknown")
        {
            detail = exitCode == 0
                ? "GitHub Copilot CLI version could not be determined."
                : $"GitHub Copilot CLI version check exited with code {exitCode}.";
        }

        return new SidecarCopilotCliVersionDiagnosticsDto
        {
            Status = status,
            InstalledVersion = installedVersion,
            LatestVersion = latestVersion,
            Detail = detail,
        };
    }

    internal static string ClassifyCliVersionStatus(string output, int exitCode = 0)
    {
        if (string.IsNullOrWhiteSpace(output))
        {
            return "unknown";
        }

        if (LatestVersionIndicators.Any(indicator =>
            output.Contains(indicator, StringComparison.OrdinalIgnoreCase)))
        {
            return "latest";
        }

        if (OutdatedVersionIndicators.Any(indicator =>
            output.Contains(indicator, StringComparison.OrdinalIgnoreCase)))
        {
            return "outdated";
        }

        return exitCode == 0 && ExtractInstalledVersion(output) is not null
            ? "unknown"
            : "unknown";
    }

    internal static string? ExtractInstalledVersion(string output)
    {
        Match match = SemanticVersionPattern().Match(output);
        return match.Success ? match.Groups["version"].Value : null;
    }

    internal static string? ExtractLatestVersion(string output, string? installedVersion)
    {
        return SemanticVersionPattern()
            .Matches(output)
            .Select(match => match.Groups["version"].Value)
            .FirstOrDefault(version =>
                !string.Equals(version, installedVersion, StringComparison.OrdinalIgnoreCase));
    }

    internal static async Task<GetAuthStatusResponse?> TryGetAuthStatusAsync(
        CopilotClient client,
        CancellationToken cancellationToken)
    {
        try
        {
            return await client.GetAuthStatusAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"[aryx sidecar] Failed to inspect Copilot auth status: {exception.Message}");
            return null;
        }
    }

    internal static async Task<SidecarCopilotAccountDiagnosticsDto?> CreateAccountDiagnosticsAsync(
        GetAuthStatusResponse? authStatus,
        IReadOnlyDictionary<string, string> environment,
        CancellationToken cancellationToken)
    {
        if (authStatus is null)
        {
            return null;
        }

        string? normalizedHost = NormalizeHost(authStatus.Host);
        IReadOnlyList<string>? organizations = null;

        if (authStatus.IsAuthenticated
            && !string.IsNullOrWhiteSpace(authStatus.Login)
            && !string.IsNullOrWhiteSpace(normalizedHost))
        {
            organizations = await TryListOrganizationsAsync(
                authStatus.Login,
                normalizedHost,
                environment,
                cancellationToken).ConfigureAwait(false);
        }

        return new SidecarCopilotAccountDiagnosticsDto
        {
            Authenticated = authStatus.IsAuthenticated,
            Login = authStatus.Login,
            Host = normalizedHost,
            AuthType = authStatus.AuthType,
            StatusMessage = authStatus.StatusMessage,
            Organizations = organizations,
        };
    }

    internal static string? NormalizeHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            return null;
        }

        string trimmed = host.Trim();
        if (Uri.TryCreate(trimmed, UriKind.Absolute, out Uri? uri))
        {
            return uri.Host;
        }

        return trimmed
            .Replace("https://", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("http://", string.Empty, StringComparison.OrdinalIgnoreCase)
            .TrimEnd('/');
    }

    internal static IReadOnlyList<string> ParseOrganizationsOutput(string? output)
    {
        return (output ?? string.Empty)
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static async Task<IReadOnlyList<string>?> TryListOrganizationsAsync(
        string login,
        string host,
        IReadOnlyDictionary<string, string> environment,
        CancellationToken cancellationToken)
    {
        CommandResult? loginResult = await TryRunGhCommandAsync(
            ["api", "--hostname", host, "user", "--jq", ".login"],
            environment,
            cancellationToken).ConfigureAwait(false);

        string? resolvedLogin = loginResult is { ExitCode: 0 }
            ? loginResult.StandardOutput.Trim()
            : null;

        if (string.IsNullOrWhiteSpace(resolvedLogin)
            || !string.Equals(resolvedLogin, login, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        CommandResult? organizationsResult = await TryRunGhCommandAsync(
            ["api", "--hostname", host, "user/orgs", "--jq", ".[].login"],
            environment,
            cancellationToken).ConfigureAwait(false);

        return organizationsResult is { ExitCode: 0 }
            ? ParseOrganizationsOutput(organizationsResult.StandardOutput)
            : null;
    }

    private static async Task<CommandResult?> TryRunGhCommandAsync(
        IReadOnlyList<string> arguments,
        IReadOnlyDictionary<string, string> environment,
        CancellationToken cancellationToken)
    {
        try
        {
            return await RunProcessAsync(
                executablePath: OperatingSystem.IsWindows() ? "gh.exe" : "gh",
                arguments,
                environment,
                GitHubContextTimeout,
                cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
        catch
        {
            return null;
        }
    }

    private static async Task<CommandResult> RunProcessAsync(
        string executablePath,
        IReadOnlyList<string> arguments,
        IReadOnlyDictionary<string, string> environment,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        using CancellationTokenSource timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);

        using Process process = new()
        {
            StartInfo = CreateProcessStartInfo(executablePath, arguments, environment),
        };

        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start command '{executablePath}'.");
        }

        process.StandardInput.Close();
        Task<string> standardOutputTask = process.StandardOutput.ReadToEndAsync(timeoutSource.Token);
        Task<string> standardErrorTask = process.StandardError.ReadToEndAsync(timeoutSource.Token);

        await process.WaitForExitAsync(timeoutSource.Token).ConfigureAwait(false);

        return new CommandResult(
            process.ExitCode,
            await standardOutputTask.ConfigureAwait(false),
            await standardErrorTask.ConfigureAwait(false));
    }

    private static ProcessStartInfo CreateProcessStartInfo(
        string executablePath,
        IReadOnlyList<string> arguments,
        IReadOnlyDictionary<string, string> environment)
    {
        ProcessStartInfo startInfo = new()
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        if (OperatingSystem.IsWindows() && RequiresWindowsShell(executablePath))
        {
            startInfo.FileName = string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ComSpec"))
                ? "cmd.exe"
                : Environment.GetEnvironmentVariable("ComSpec");

            startInfo.ArgumentList.Add("/d");
            startInfo.ArgumentList.Add("/s");
            startInfo.ArgumentList.Add("/c");
            startInfo.ArgumentList.Add(BuildWindowsShellCommand(executablePath, arguments));
        }
        else
        {
            startInfo.FileName = executablePath;
            foreach (string argument in arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }
        }

        startInfo.Environment.Clear();
        foreach (KeyValuePair<string, string> entry in environment)
        {
            startInfo.Environment[entry.Key] = entry.Value;
        }

        return startInfo;
    }

    private static bool RequiresWindowsShell(string executablePath)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        string extension = Path.GetExtension(executablePath);
        return extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".bat", StringComparison.OrdinalIgnoreCase);
    }

    private static string BuildWindowsShellCommand(string executablePath, IReadOnlyList<string> arguments)
    {
        IEnumerable<string> tokens = [executablePath, .. arguments];
        return string.Join(" ", tokens.Select(QuoteWindowsShellToken));
    }

    private static string QuoteWindowsShellToken(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        bool needsQuotes = value.Any(character =>
            char.IsWhiteSpace(character)
            || character is '&' or '(' or ')' or '[' or ']' or '{' or '}' or '^' or '=' or ';' or '!' or '+' or ',' or '`' or '~');

        if (!needsQuotes)
        {
            return value;
        }

        return "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static string NormalizeOutput(string? standardOutput, string? standardError)
    {
        return string.Join(
            Environment.NewLine,
            new[] { standardOutput, standardError }
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value!.Trim()));
    }

    private sealed record CommandResult(int ExitCode, string StandardOutput, string StandardError);

    [GeneratedRegex(@"\b(?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z\.-]+)?)\b", RegexOptions.Compiled)]
    private static partial Regex SemanticVersionPattern();
}
