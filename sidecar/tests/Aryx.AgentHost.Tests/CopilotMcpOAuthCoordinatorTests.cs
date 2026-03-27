using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotMcpOAuthCoordinatorTests
{
    [Fact]
    public void BuildMcpOauthRequiredEvent_MapsSdkEventToProtocolEvent()
    {
        CopilotMcpOAuthCoordinator coordinator = new();
        RunTurnCommandDto command = CreateCommand();

        McpOauthRequiredEventDto oauthEvent = coordinator.BuildMcpOauthRequiredEvent(
            command,
            command.Pattern.Agents[0],
            new McpOauthRequiredEvent
            {
                Data = new McpOauthRequiredData
                {
                    RequestId = " oauth-request-1 ",
                    ServerName = " Example MCP ",
                    ServerUrl = " https://example.com/mcp ",
                    StaticClientConfig = new McpOauthRequiredDataStaticClientConfig
                    {
                        ClientId = " aryx-client ",
                        PublicClient = true,
                    },
                },
            });

        Assert.Equal("mcp-oauth-required", oauthEvent.Type);
        Assert.Equal("turn-1", oauthEvent.RequestId);
        Assert.Equal("session-1", oauthEvent.SessionId);
        Assert.Equal("oauth-request-1", oauthEvent.OauthRequestId);
        Assert.Equal("agent-1", oauthEvent.AgentId);
        Assert.Equal("Primary", oauthEvent.AgentName);
        Assert.Equal("Example MCP", oauthEvent.ServerName);
        Assert.Equal("https://example.com/mcp", oauthEvent.ServerUrl);
        Assert.NotNull(oauthEvent.StaticClientConfig);
        Assert.Equal("aryx-client", oauthEvent.StaticClientConfig!.ClientId);
        Assert.True(oauthEvent.StaticClientConfig.PublicClient);
    }

    private static RunTurnCommandDto CreateCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-1",
                Name = "MCP OAuth Pattern",
                Mode = "single",
                Availability = "available",
                Agents =
                [
                    new PatternAgentDefinitionDto
                    {
                        Id = "agent-1",
                        Name = "Primary",
                        Model = "gpt-5.4",
                        Instructions = "Help with the request.",
                    },
                ],
            },
        };
    }
}
