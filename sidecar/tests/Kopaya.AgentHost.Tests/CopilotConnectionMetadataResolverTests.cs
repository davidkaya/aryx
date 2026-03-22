using Kopaya.AgentHost.Contracts;
using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class CopilotConnectionMetadataResolverTests
{
    [Fact]
    public void ParseCliVersionOutput_ReturnsLatestStatusForCurrentInstall()
    {
        SidecarCopilotCliVersionDiagnosticsDto diagnostics =
            CopilotConnectionMetadataResolver.ParseCliVersionOutput(
                """
                GitHub Copilot CLI 1.0.10
                You are running the latest version.
                """);

        Assert.Equal("latest", diagnostics.Status);
        Assert.Equal("1.0.10", diagnostics.InstalledVersion);
        Assert.Equal("1.0.10", diagnostics.LatestVersion);
    }

    [Fact]
    public void ParseCliVersionOutput_ReturnsOutdatedStatusWhenNewerVersionIsAvailable()
    {
        SidecarCopilotCliVersionDiagnosticsDto diagnostics =
            CopilotConnectionMetadataResolver.ParseCliVersionOutput(
                """
                GitHub Copilot CLI 1.0.9
                A newer version 1.0.10 is available.
                Run 'copilot update' to install it.
                """);

        Assert.Equal("outdated", diagnostics.Status);
        Assert.Equal("1.0.9", diagnostics.InstalledVersion);
        Assert.Equal("1.0.10", diagnostics.LatestVersion);
    }

    [Fact]
    public void NormalizeHost_StripsSchemeAndTrailingSlash()
    {
        string? host = CopilotConnectionMetadataResolver.NormalizeHost("https://github.example.com/");

        Assert.Equal("github.example.com", host);
    }

    [Fact]
    public void ParseOrganizationsOutput_ReturnsDistinctOrganizations()
    {
        IReadOnlyList<string> organizations = CopilotConnectionMetadataResolver.ParseOrganizationsOutput(
            """
            github
            octo-org
            github
            """);

        Assert.Equal(["github", "octo-org"], organizations);
    }
}
