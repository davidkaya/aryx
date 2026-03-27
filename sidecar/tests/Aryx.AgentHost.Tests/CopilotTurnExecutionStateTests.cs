using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotTurnExecutionStateTests
{
    [Fact]
    public void ObserveSessionEvent_McpOauthRequired_SetsActiveAgent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            new McpOauthRequiredEvent
            {
                Data = new McpOauthRequiredData
                {
                    RequestId = "oauth-request-1",
                    ServerName = "Example MCP",
                    ServerUrl = "https://example.com/mcp",
                },
            });

        Assert.True(state.ActiveAgent.HasValue);
        Assert.Equal("agent-1", state.ActiveAgent.Value.AgentId);
        Assert.Equal("Primary", state.ActiveAgent.Value.AgentName);
    }

    [Fact]
    public void DrainPendingMcpOauthRequests_ReturnsQueuedRequestsAndClearsQueue()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);
        McpOauthRequiredEventDto request = new()
        {
            Type = "mcp-oauth-required",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            OauthRequestId = "oauth-request-1",
            ServerName = "Example MCP",
            ServerUrl = "https://example.com/mcp",
        };

        state.EnqueuePendingMcpOauthRequest(request);

        IReadOnlyList<McpOauthRequiredEventDto> firstDrain = state.DrainPendingMcpOauthRequests();
        IReadOnlyList<McpOauthRequiredEventDto> secondDrain = state.DrainPendingMcpOauthRequests();

        McpOauthRequiredEventDto drained = Assert.Single(firstDrain);
        Assert.Equal("oauth-request-1", drained.OauthRequestId);
        Assert.Empty(secondDrain);
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
