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
}
