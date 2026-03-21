using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class CopilotCliPathResolverTests
{
    [Fact]
    public void Resolve_UsesCopilotFromPathDuringDevelopment()
    {
        string copilotDirectory = @"C:\tools\copilot";
        HashSet<string> existingFiles = new(StringComparer.OrdinalIgnoreCase)
        {
            Path.Combine(copilotDirectory, "copilot.exe"),
        };

        CopilotCliResolution resolution = CopilotCliPathResolver.Resolve(
            processPath: @"C:\Program Files\dotnet\dotnet.exe",
            pathValue: $"C:\\other;\"{copilotDirectory}\"",
            pathExtValue: ".COM;.EXE;.BAT;.CMD",
            isWindows: true,
            fileExists: existingFiles.Contains);

        Assert.True(resolution.ShouldOverrideCliPath);
        Assert.Equal(Path.Combine(copilotDirectory, "copilot.exe"), resolution.CliPath, ignoreCase: true);
    }

    [Fact]
    public void Resolve_LeavesPackagedRuntimeOnBundledCli()
    {
        CopilotCliResolution resolution = CopilotCliPathResolver.Resolve(
            processPath: @"C:\Program Files\Kopaya\Kopaya.AgentHost.exe",
            pathValue: @"C:\tools",
            pathExtValue: ".COM;.EXE;.BAT;.CMD",
            isWindows: true,
            fileExists: _ => true);

        Assert.False(resolution.ShouldOverrideCliPath);
        Assert.Null(resolution.CliPath);
    }

    [Fact]
    public void Resolve_ReportsMissingCopilotWhenDevelopmentPathDoesNotContainIt()
    {
        CopilotCliResolution resolution = CopilotCliPathResolver.Resolve(
            processPath: @"C:\Program Files\dotnet\dotnet.exe",
            pathValue: @"C:\tools;C:\other",
            pathExtValue: ".COM;.EXE;.BAT;.CMD",
            isWindows: true,
            fileExists: _ => false);

        Assert.True(resolution.ShouldOverrideCliPath);
        Assert.Null(resolution.CliPath);
    }
}
