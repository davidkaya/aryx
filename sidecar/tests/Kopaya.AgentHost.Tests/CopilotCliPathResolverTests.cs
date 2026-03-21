using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class CopilotCliPathResolverTests
{
    [Fact]
    public void Resolve_UsesCopilotFromPath()
    {
        string copilotDirectory = @"C:\tools\copilot";
        HashSet<string> existingFiles = new(StringComparer.OrdinalIgnoreCase)
        {
            Path.Combine(copilotDirectory, "copilot.exe"),
        };

        string? cliPath = CopilotCliPathResolver.Resolve(
            pathValue: $"C:\\other;\"{copilotDirectory}\"",
            pathExtValue: ".COM;.EXE;.BAT;.CMD",
            isWindows: true,
            fileExists: existingFiles.Contains);

        Assert.Equal(Path.Combine(copilotDirectory, "copilot.exe"), cliPath, ignoreCase: true);
    }

    [Fact]
    public void Resolve_UsesDefaultWindowsExtensionsWhenPathExtMissing()
    {
        string copilotDirectory = @"C:\tools\copilot";
        HashSet<string> existingFiles = new(StringComparer.OrdinalIgnoreCase)
        {
            Path.Combine(copilotDirectory, "copilot.cmd"),
        };

        string? cliPath = CopilotCliPathResolver.Resolve(
            pathValue: $"C:\\other;\"{copilotDirectory}\"",
            pathExtValue: null,
            isWindows: true,
            fileExists: existingFiles.Contains);

        Assert.Equal(Path.Combine(copilotDirectory, "copilot.cmd"), cliPath, ignoreCase: true);
    }

    [Fact]
    public void Resolve_ReturnsNullWhenPathDoesNotContainCopilot()
    {
        string? cliPath = CopilotCliPathResolver.Resolve(
            pathValue: @"C:\tools;C:\other",
            pathExtValue: ".COM;.EXE;.BAT;.CMD",
            isWindows: true,
            fileExists: _ => false);

        Assert.Null(cliPath);
    }

    [Fact]
    public void ResolveCliEnvironment_RemovesRuntimeSpecificPrefixes()
    {
        IReadOnlyDictionary<string, string> environment = CopilotCliPathResolver.ResolveCliEnvironment(
        [
            new KeyValuePair<string, string?>("PATH", @"C:\tools"),
            new KeyValuePair<string, string?>("APPDATA", @"C:\Users\mail\AppData\Roaming"),
            new KeyValuePair<string, string?>("COPILOT_CLI", "1"),
            new KeyValuePair<string, string?>("NODE_OPTIONS", "--no-warnings"),
            new KeyValuePair<string, string?>("electron_run_as_node", "1"),
            new KeyValuePair<string, string?>("BUN_FAKE_FLAG", "1"),
            new KeyValuePair<string, string?>("npm_config_user_agent", "bun/1.3.6"),
        ]);

        Assert.Equal(
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["PATH"] = @"C:\tools",
                ["APPDATA"] = @"C:\Users\mail\AppData\Roaming",
            },
            environment);
    }

    [Fact]
    public void ResolveCliEnvironment_PreservesUnrelatedVariables()
    {
        IReadOnlyDictionary<string, string> environment = CopilotCliPathResolver.ResolveCliEnvironment(
        [
            new KeyValuePair<string, string?>("PATH", @"C:\tools"),
            new KeyValuePair<string, string?>("HOME", @"C:\Users\mail"),
            new KeyValuePair<string, string?>("HTTPS_PROXY", "http://proxy.local:8080"),
            new KeyValuePair<string, string?>("FORCE_COLOR", "1"),
        ]);

        Assert.Equal(
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["PATH"] = @"C:\tools",
                ["HOME"] = @"C:\Users\mail",
                ["HTTPS_PROXY"] = "http://proxy.local:8080",
                ["FORCE_COLOR"] = "1",
            },
            environment);
    }

    [Fact]
    public void ResolveCliLaunch_UsesCommandProcessorWrapperOnWindows()
    {
        CopilotCliLaunch launch = CopilotCliPathResolver.ResolveCliLaunch(
            cliPath: @"C:\Tools With Spaces\copilot.exe",
            isWindows: true,
            commandProcessorPath: @"C:\Windows\System32\cmd.exe");

        Assert.Equal(@"C:\Windows\System32\cmd.exe", launch.Path);
        Assert.Equal(
            ["/d", "/s", "/c", "copilot"],
            launch.Args);
    }

    [Fact]
    public void ResolveCliLaunch_UsesCliDirectlyOutsideWindows()
    {
        CopilotCliLaunch launch = CopilotCliPathResolver.ResolveCliLaunch(
            cliPath: "/usr/local/bin/copilot",
            isWindows: false,
            commandProcessorPath: null);

        Assert.Equal("/usr/local/bin/copilot", launch.Path);
        Assert.Empty(launch.Args);
    }
}
