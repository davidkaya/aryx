using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class HookCommandRunnerTests
{
    [Fact]
    public async Task RunAsync_PipesJsonIntoHookStandardInput()
    {
        HookCommandRunner runner = new();
        using TestDirectory project = new();
        HookCommandDefinition hook = CreatePlatformHook(
            OperatingSystem.IsWindows()
                ? "$payload = [Console]::In.ReadToEnd(); Write-Output $payload"
                : "payload=$(cat); printf '%s' \"$payload\"");

        string input = """{"toolName":"view","toolArgs":"{\"path\":\"README.md\"}"}""";

        string? output = await runner.RunAsync(hook, input, project.Path, CancellationToken.None);

        Assert.Equal(input, output?.Trim());
    }

    [Fact]
    public async Task RunAsync_ReturnsNullWhenHookTimesOut()
    {
        HookCommandRunner runner = new();
        using TestDirectory project = new();
        HookCommandDefinition hook = CreatePlatformHook(
            OperatingSystem.IsWindows() ? "Start-Sleep -Seconds 5" : "sleep 5",
            timeoutSec: 1);

        string? output = await runner.RunAsync(hook, "{}", project.Path, CancellationToken.None);

        Assert.Null(output);
    }

    [Fact]
    public async Task RunAsync_ReturnsNullWhenHookFails()
    {
        HookCommandRunner runner = new();
        using TestDirectory project = new();
        HookCommandDefinition hook = CreatePlatformHook(
            OperatingSystem.IsWindows() ? "Write-Error 'boom'; exit 1" : "echo boom >&2; exit 1");

        string? output = await runner.RunAsync(hook, "{}", project.Path, CancellationToken.None);

        Assert.Null(output);
    }

    [Fact]
    public async Task RunAsync_ReturnsNullWhenCurrentPlatformCommandIsMissing()
    {
        HookCommandRunner runner = new();
        using TestDirectory project = new();
        HookCommandDefinition hook = OperatingSystem.IsWindows()
            ? new HookCommandDefinition { Type = "command", Bash = "echo unsupported" }
            : new HookCommandDefinition { Type = "command", PowerShell = "Write-Output unsupported" };

        string? output = await runner.RunAsync(hook, "{}", project.Path, CancellationToken.None);

        Assert.Null(output);
    }

    [Fact]
    public async Task RunAsync_UsesConfiguredWorkingDirectoryAndEnvironment()
    {
        HookCommandRunner runner = new();
        using TestDirectory project = new();
        string hooksDirectory = Directory.CreateDirectory(Path.Combine(project.Path, "scripts")).FullName;
        HookCommandDefinition hook = CreatePlatformHook(
            OperatingSystem.IsWindows()
                ? "$null = [Console]::In.ReadToEnd(); Write-Output ([Environment]::CurrentDirectory + '|' + $env:HOOK_TEST_ENV)"
                : "cat >/dev/null; printf '%s|%s' \"$(pwd)\" \"$HOOK_TEST_ENV\"",
            cwd: "scripts",
            env: new Dictionary<string, string>
            {
                ["HOOK_TEST_ENV"] = "configured",
            });

        string? output = await runner.RunAsync(hook, "{}", project.Path, CancellationToken.None);

        Assert.Equal($"{hooksDirectory}|configured", output?.Trim());
    }

    private static HookCommandDefinition CreatePlatformHook(
        string command,
        int? timeoutSec = null,
        string? cwd = null,
        IReadOnlyDictionary<string, string>? env = null)
    {
        return OperatingSystem.IsWindows()
            ? new HookCommandDefinition
            {
                Type = "command",
                PowerShell = command,
                TimeoutSec = timeoutSec,
                Cwd = cwd,
                Env = env,
            }
            : new HookCommandDefinition
            {
                Type = "command",
                Bash = command,
                TimeoutSec = timeoutSec,
                Cwd = cwd,
                Env = env,
            };
    }

    private sealed class TestDirectory : IDisposable
    {
        private readonly DirectoryInfo _directory = Directory.CreateTempSubdirectory("aryx-hooks-runner-");

        public string Path => _directory.FullName;

        public void Dispose()
        {
            if (_directory.Exists)
            {
                _directory.Delete(recursive: true);
            }
        }
    }
}
