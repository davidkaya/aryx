using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class HookConfigLoaderTests
{
    [Fact]
    public async Task LoadAsync_ParsesSupportedHookTypes()
    {
        using TestDirectory project = new();
        string hooksDirectory = Directory.CreateDirectory(Path.Combine(project.Path, ".github", "hooks")).FullName;

        await File.WriteAllTextAsync(
            Path.Combine(hooksDirectory, "hooks.json"),
            """
            {
              "version": 1,
              "hooks": {
                "sessionStart": [
                  {
                    "type": "command",
                    "bash": "echo session-start",
                    "powershell": "Write-Output session-start",
                    "cwd": ".",
                    "env": { "HOOK_MODE": "audit" },
                    "timeoutSec": 15
                  }
                ],
                "preToolUse": [
                  {
                    "type": "command",
                    "bash": "echo pre-tool",
                    "powershell": "Write-Output pre-tool"
                  }
                ],
                "errorOccurred": [
                  {
                    "type": "command",
                    "bash": "echo error-hook",
                    "powershell": "Write-Output error-hook"
                  }
                ]
              }
            }
            """);

        ResolvedHookSet hooks = await HookConfigLoader.LoadAsync(project.Path, CancellationToken.None);

        HookCommandDefinition sessionStart = Assert.Single(hooks.SessionStart);
        Assert.Equal("command", sessionStart.Type);
        Assert.Equal("echo session-start", sessionStart.Bash);
        Assert.Equal("Write-Output session-start", sessionStart.PowerShell);
        Assert.Equal(".", sessionStart.Cwd);
        Assert.Equal(15, sessionStart.TimeoutSec);
        Assert.NotNull(sessionStart.Env);
        Assert.Equal("audit", sessionStart.Env["HOOK_MODE"]);
        Assert.Single(hooks.PreToolUse);
        Assert.Single(hooks.ErrorOccurred);
        Assert.False(hooks.IsEmpty);
    }

    [Fact]
    public async Task LoadAsync_MergesHookFilesInFileNameOrder()
    {
        using TestDirectory project = new();
        string hooksDirectory = Directory.CreateDirectory(Path.Combine(project.Path, ".github", "hooks")).FullName;

        await File.WriteAllTextAsync(
            Path.Combine(hooksDirectory, "20-second.json"),
            """
            {
              "version": 1,
              "hooks": {
                "preToolUse": [
                  {
                    "type": "command",
                    "bash": "echo second",
                    "powershell": "Write-Output second"
                  }
                ]
              }
            }
            """);
        await File.WriteAllTextAsync(
            Path.Combine(hooksDirectory, "10-first.json"),
            """
            {
              "version": 1,
              "hooks": {
                "preToolUse": [
                  {
                    "type": "command",
                    "bash": "echo first",
                    "powershell": "Write-Output first"
                  }
                ]
              }
            }
            """);

        ResolvedHookSet hooks = await HookConfigLoader.LoadAsync(project.Path, CancellationToken.None);

        string[] commands = hooks.PreToolUse.Select(GetCommandText).ToArray();
        Assert.Equal(2, commands.Length);
        Assert.Contains("first", commands[0], StringComparison.Ordinal);
        Assert.Contains("second", commands[1], StringComparison.Ordinal);
    }

    [Fact]
    public async Task LoadAsync_ReturnsEmptyWhenHooksDirectoryIsMissing()
    {
        using TestDirectory project = new();

        ResolvedHookSet hooks = await HookConfigLoader.LoadAsync(project.Path, CancellationToken.None);

        Assert.Same(ResolvedHookSet.Empty, hooks);
    }

    [Fact]
    public async Task LoadAsync_SkipsInvalidFilesAndUnsupportedVersions()
    {
        using TestDirectory project = new();
        string hooksDirectory = Directory.CreateDirectory(Path.Combine(project.Path, ".github", "hooks")).FullName;

        await File.WriteAllTextAsync(Path.Combine(hooksDirectory, "00-invalid.json"), "{ not-json");
        await File.WriteAllTextAsync(
            Path.Combine(hooksDirectory, "10-unsupported.json"),
            """
            {
              "version": 2,
              "hooks": {
                "sessionStart": [
                  {
                    "type": "command",
                    "bash": "echo unsupported",
                    "powershell": "Write-Output unsupported"
                  }
                ]
              }
            }
            """);
        await File.WriteAllTextAsync(
            Path.Combine(hooksDirectory, "20-valid.json"),
            """
            {
              "version": 1,
              "hooks": {
                "sessionEnd": [
                  {
                    "type": "command",
                    "bash": "echo valid",
                    "powershell": "Write-Output valid"
                  }
                ]
              }
            }
            """);

        ResolvedHookSet hooks = await HookConfigLoader.LoadAsync(project.Path, CancellationToken.None);

        HookCommandDefinition valid = Assert.Single(hooks.SessionEnd);
        Assert.Contains("valid", GetCommandText(valid), StringComparison.Ordinal);
        Assert.Empty(hooks.SessionStart);
    }

    [Fact]
    public async Task LoadAsync_ReturnsEmptyForEmptyHooksObject()
    {
        using TestDirectory project = new();
        string hooksDirectory = Directory.CreateDirectory(Path.Combine(project.Path, ".github", "hooks")).FullName;

        await File.WriteAllTextAsync(
            Path.Combine(hooksDirectory, "hooks.json"),
            """
            {
              "version": 1,
              "hooks": {}
            }
            """);

        ResolvedHookSet hooks = await HookConfigLoader.LoadAsync(project.Path, CancellationToken.None);

        Assert.Same(ResolvedHookSet.Empty, hooks);
    }

    private static string GetCommandText(HookCommandDefinition hook)
        => hook.PowerShell ?? hook.Bash ?? string.Empty;

    private sealed class TestDirectory : IDisposable
    {
        private readonly DirectoryInfo _directory = Directory.CreateTempSubdirectory("aryx-hooks-loader-");

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
