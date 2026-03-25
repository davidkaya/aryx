using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class SessionToolingBundleTests
{
    [Fact]
    public void BuildMcpServerConfigurations_MapsLocalAndRemoteServers()
    {
        IReadOnlyList<RunTurnMcpServerConfigDto> servers =
        [
            new()
            {
                Id = "mcp-local",
                Name = "Local MCP",
                Transport = "local",
                Command = "node",
                Args = ["server.js", "--stdio"],
                Env = new Dictionary<string, string>
                {
                    ["DEBUG"] = "true",
                },
                Cwd = @"C:\workspace\repo",
                Tools = ["git.status"],
                TimeoutMs = 1500,
            },
            new()
            {
                Id = "mcp-remote",
                Name = "Remote MCP",
                Transport = "http",
                Url = "https://example.com/mcp",
                Headers = new Dictionary<string, string>
                {
                    ["Authorization"] = "Bearer token",
                },
                Tools = ["*"],
            },
        ];

        Dictionary<string, object> configurations = SessionToolingBundle.BuildMcpServerConfigurations(servers);

        McpLocalServerConfig localConfig = Assert.IsType<McpLocalServerConfig>(configurations["Local MCP"]);
        Assert.Equal("local", localConfig.Type);
        Assert.Equal("node", localConfig.Command);
        Assert.Equal(["server.js", "--stdio"], localConfig.Args);
        KeyValuePair<string, string> localEnv = Assert.Single(localConfig.Env!);
        Assert.Equal("DEBUG", localEnv.Key);
        Assert.Equal("true", localEnv.Value);
        Assert.Equal(@"C:\workspace\repo", localConfig.Cwd);
        Assert.Equal(["git.status"], localConfig.Tools);
        Assert.Equal(1500, localConfig.Timeout);

        McpRemoteServerConfig remoteConfig = Assert.IsType<McpRemoteServerConfig>(configurations["Remote MCP"]);
        Assert.Equal("http", remoteConfig.Type);
        Assert.Equal("https://example.com/mcp", remoteConfig.Url);
        KeyValuePair<string, string> remoteHeader = Assert.Single(remoteConfig.Headers!);
        Assert.Equal("Authorization", remoteHeader.Key);
        Assert.Equal("Bearer token", remoteHeader.Value);
        Assert.Equal(["*"], remoteConfig.Tools);
    }

    [Fact]
    public void BuildMcpServerConfigurations_DefaultsMissingToolsToWildcard()
    {
        IReadOnlyList<RunTurnMcpServerConfigDto> servers =
        [
            new()
            {
                Id = "mcp-local",
                Transport = "local",
                Command = "node",
                Tools = [],
            },
        ];

        Dictionary<string, object> configurations = SessionToolingBundle.BuildMcpServerConfigurations(servers);
        McpLocalServerConfig localConfig = Assert.IsType<McpLocalServerConfig>(configurations["mcp-local"]);

        Assert.Equal(["*"], localConfig.Tools);
    }

    [Fact]
    public void BuildMcpServerConfigurations_RejectsMissingTransportTargets()
    {
        InvalidOperationException localError = Assert.Throws<InvalidOperationException>(
            () => SessionToolingBundle.BuildMcpServerConfigurations(
                [
                    new RunTurnMcpServerConfigDto
                    {
                        Id = "mcp-local",
                        Name = "Local MCP",
                        Transport = "local",
                    },
                ]));
        Assert.Contains("missing a command", localError.Message);

        InvalidOperationException remoteError = Assert.Throws<InvalidOperationException>(
            () => SessionToolingBundle.BuildMcpServerConfigurations(
                [
                    new RunTurnMcpServerConfigDto
                    {
                        Id = "mcp-remote",
                        Name = "Remote MCP",
                        Transport = "sse",
                    },
                ]));
        Assert.Contains("missing a URL", remoteError.Message);
    }
}
