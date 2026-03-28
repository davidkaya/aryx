using System.ComponentModel;
using System.Diagnostics;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal interface IHookCommandRunner
{
    Task<string?> RunAsync(
        HookCommandDefinition hook,
        string inputJson,
        string projectPath,
        CancellationToken cancellationToken);
}

internal sealed class HookCommandRunner : IHookCommandRunner
{
    private const int DefaultTimeoutSeconds = 30;

    public static HookCommandRunner Instance { get; } = new();

    public async Task<string?> RunAsync(
        HookCommandDefinition hook,
        string inputJson,
        string projectPath,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(hook);
        ArgumentNullException.ThrowIfNull(inputJson);
        ArgumentException.ThrowIfNullOrWhiteSpace(projectPath);

        string? commandText = SelectCommandText(hook);
        if (commandText is null)
        {
            Console.Error.WriteLine("[aryx hooks] Skipping hook because no compatible shell command is configured for this platform.");
            return null;
        }

        string workingDirectory = ResolveWorkingDirectory(projectPath, hook.Cwd);
        ProcessStartInfo startInfo = CreateStartInfo(commandText, workingDirectory);
        ApplyEnvironment(startInfo, hook.Env);

        using Process process = new()
        {
            StartInfo = startInfo,
        };

        try
        {
            if (!process.Start())
            {
                Console.Error.WriteLine($"[aryx hooks] Failed to start hook command '{commandText}'.");
                return null;
            }
        }
        catch (Win32Exception exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Failed to start hook command '{commandText}': {exception.Message}");
            return null;
        }
        catch (InvalidOperationException exception)
        {
            Console.Error.WriteLine($"[aryx hooks] Failed to start hook command '{commandText}': {exception.Message}");
            return null;
        }

        Task<string> stdoutTask = process.StandardOutput.ReadToEndAsync();
        Task<string> stderrTask = process.StandardError.ReadToEndAsync();

        try
        {
            await process.StandardInput.WriteAsync(inputJson).ConfigureAwait(false);
            await process.StandardInput.FlushAsync().ConfigureAwait(false);
            process.StandardInput.Close();
        }
        catch (IOException exception)
        {
            TryKillProcess(process);
            Console.Error.WriteLine($"[aryx hooks] Failed to write hook input for '{commandText}': {exception.Message}");
            return null;
        }
        catch (ObjectDisposedException exception)
        {
            TryKillProcess(process);
            Console.Error.WriteLine($"[aryx hooks] Failed to write hook input for '{commandText}': {exception.Message}");
            return null;
        }

        TimeSpan timeout = TimeSpan.FromSeconds(hook.TimeoutSec ?? DefaultTimeoutSeconds);
        using CancellationTokenSource timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        try
        {
            await process.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            TryKillProcess(process);
            await DrainOutputAsync(process, stdoutTask, stderrTask).ConfigureAwait(false);
            Console.Error.WriteLine($"[aryx hooks] Hook command timed out after {(int)timeout.TotalSeconds} seconds: '{commandText}'.");
            return null;
        }

        string stdout = await stdoutTask.ConfigureAwait(false);
        string stderr = await stderrTask.ConfigureAwait(false);
        if (process.ExitCode != 0)
        {
            string detail = string.IsNullOrWhiteSpace(stderr) ? $"exit code {process.ExitCode}" : stderr.Trim();
            Console.Error.WriteLine($"[aryx hooks] Hook command failed for '{commandText}': {detail}");
            return null;
        }

        return stdout;
    }

    private static async Task DrainOutputAsync(Process process, Task<string> stdoutTask, Task<string> stderrTask)
    {
        try
        {
            await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (InvalidOperationException)
        {
            // Process already exited or could not be waited on.
        }

        await Task.WhenAll(stdoutTask, stderrTask).ConfigureAwait(false);
    }

    private static ProcessStartInfo CreateStartInfo(string commandText, string workingDirectory)
    {
        ProcessStartInfo startInfo = new()
        {
            WorkingDirectory = workingDirectory,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        if (OperatingSystem.IsWindows())
        {
            startInfo.FileName = "powershell.exe";
            startInfo.ArgumentList.Add("-NoLogo");
            startInfo.ArgumentList.Add("-NoProfile");
            startInfo.ArgumentList.Add("-NonInteractive");
            startInfo.ArgumentList.Add("-ExecutionPolicy");
            startInfo.ArgumentList.Add("Bypass");
            startInfo.ArgumentList.Add("-Command");
            startInfo.ArgumentList.Add(commandText);
            return startInfo;
        }

        startInfo.FileName = "bash";
        startInfo.ArgumentList.Add("-lc");
        startInfo.ArgumentList.Add(commandText);
        return startInfo;
    }

    private static void ApplyEnvironment(ProcessStartInfo startInfo, IReadOnlyDictionary<string, string>? environment)
    {
        if (environment is not { Count: > 0 })
        {
            return;
        }

        foreach ((string key, string value) in environment)
        {
            startInfo.Environment[key] = value;
        }
    }

    private static string ResolveWorkingDirectory(string projectPath, string? configuredCwd)
    {
        if (string.IsNullOrWhiteSpace(configuredCwd))
        {
            return Path.GetFullPath(projectPath);
        }

        string resolved = Path.IsPathRooted(configuredCwd)
            ? configuredCwd
            : Path.Combine(projectPath, configuredCwd);

        return Path.GetFullPath(resolved);
    }

    private static string? SelectCommandText(HookCommandDefinition hook)
    {
        if (OperatingSystem.IsWindows())
        {
            return NormalizeOptionalString(hook.PowerShell);
        }

        return NormalizeOptionalString(hook.Bash);
    }

    private static void TryKillProcess(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
            // Process already exited.
        }
        catch (NotSupportedException)
        {
            // The platform does not support process tree termination.
        }
    }

    private static string? NormalizeOptionalString(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
